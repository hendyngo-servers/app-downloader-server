require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_FILE = path.resolve(process.env.DATA_FILE || path.join(ROOT, "data.json"));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, "uploads"));
const MAX_UPLOAD_BYTES = Math.max(1, Number(process.env.MAX_UPLOAD_MB || 500)) * 1024 * 1024;
const SESSION_COOKIE = "appdownloader_admin";
const SESSION_HOURS = Math.min(72, Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12)));
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "")
  .split(",").map(function (item) { return item.trim().replace(/\/$/, ""); }).filter(Boolean);
const COOKIE_SAME_SITE = (process.env.COOKIE_SAME_SITE || "lax").toLowerCase();
const ALLOWED_EXTENSIONS = new Set([
  ".apk", ".aab", ".ipa", ".zip", ".7z", ".rar", ".exe", ".msi",
  ".dmg", ".pkg", ".appimage", ".deb", ".rpm", ".tar", ".gz"
]);

const EMPTY_DB = {
  apps: [],
  builds: [],
  licenses: [],
  stats: { visits: 0, downloads: 0, uploads: 0 },
  auditLog: []
};

let writeChain = Promise.resolve();

function cloneEmptyDb() {
  return JSON.parse(JSON.stringify(EMPTY_DB));
}

async function ensureStorage() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.writeFile(DATA_FILE, JSON.stringify(cloneEmptyDb(), null, 2) + "\n", { mode: 0o600 });
  }
}

async function readDb() {
  let raw;
  try {
    raw = await fs.readFile(DATA_FILE, "utf8");
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object") throw new Error("Database root must be an object");
    value.apps = Array.isArray(value.apps) ? value.apps : [];
    value.builds = Array.isArray(value.builds) ? value.builds : [];
    value.licenses = Array.isArray(value.licenses) ? value.licenses : [];
    value.auditLog = Array.isArray(value.auditLog) ? value.auditLog : [];
    value.stats = Object.assign({ visits: 0, downloads: 0, uploads: 0 }, value.stats || {});
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return cloneEmptyDb();
    throw new Error("Could not read data store: " + error.message);
  }
}

async function persistDb(db) {
  const tempPath = DATA_FILE + "." + process.pid + "." + crypto.randomUUID() + ".tmp";
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(tempPath, JSON.stringify(db, null, 2) + "\n", { mode: 0o600 });
  await fs.rename(tempPath, DATA_FILE);
}

async function mutateDb(mutator) {
  const task = writeChain.catch(function () {}).then(async function () {
    const db = await readDb();
    const result = await mutator(db);
    await persistDb(db);
    return result;
  });
  writeChain = task;
  return task;
}

function id() {
  return crypto.randomUUID();
}

function cleanText(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength);
}

function slugify(value) {
  return cleanText(value, 100).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    crypto.timingSafeEqual(a, a);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function isOriginAllowed(origin, req) {
  if (!origin) return true;
  const normalized = String(origin).replace(/\/$/, "");
  const sameOrigin = normalized === req.protocol + "://" + req.get("host");
  if (sameOrigin || ALLOWED_ORIGINS.includes(normalized)) return true;
  if (process.env.NODE_ENV !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(normalized)) return true;
  return false;
}

function sign(value) {
  return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function createSessionToken(username) {
  const payload = Buffer.from(JSON.stringify({
    sub: username,
    exp: Date.now() + SESSION_HOURS * 60 * 60 * 1000
  })).toString("base64url");
  return payload + "." + sign(payload);
}

function readSessionToken(token) {
  if (!token || !SESSION_SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !safeEqual(sign(parts[0]), parts[1])) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    if (payload.sub !== ADMIN_USERNAME || !Number.isFinite(payload.exp) || payload.exp < Date.now()) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

function cookieOptions(req) {
  const requestedSameSite = ["lax", "strict", "none"].includes(COOKIE_SAME_SITE) ? COOKIE_SAME_SITE : "lax";
  const isSecure = process.env.NODE_ENV === "production" || req.secure;
  return {
    httpOnly: true,
    secure: isSecure,
    sameSite: requestedSameSite,
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60 * 1000
  };
}

function requireAdmin(req, res, next) {
  const cookies = String(req.headers.cookie || "").split(";").reduce(function (out, item) {
    const index = item.indexOf("=");
    if (index > -1) out[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
    return out;
  }, {});
  const session = readSessionToken(cookies[SESSION_COOKIE]);
  if (!session) return res.status(401).json({ error: "Admin login required", code: "AUTH_REQUIRED" });
  req.admin = { username: session.sub };
  next();
}

function requireTrustedOrigin(req, res, next) {
  const origin = req.get("origin");
  if (!isOriginAllowed(origin, req)) return res.status(403).json({ error: "Request origin is not allowed" });
  next();
}

function addAudit(db, action, detail, username) {
  db.auditLog.unshift({
    id: id(),
    action: action,
    detail: cleanText(detail, 240),
    actor: username || "system",
    createdAt: new Date().toISOString()
  });
  db.auditLog = db.auditLog.slice(0, 200);
}

function publicBuild(build) {
  return {
    id: build.id,
    appId: build.appId,
    version: build.version,
    platform: build.platform,
    architecture: build.architecture || "Universal",
    fileName: build.originalName,
    size: build.size,
    checksum: build.checksum,
    releaseNotes: build.releaseNotes || "",
    publishedAt: build.publishedAt || build.createdAt,
    downloadCount: Number(build.downloadCount || 0),
    downloadUrl: "/api/download/" + encodeURIComponent(build.id)
  };
}

function publicApp(appRecord, builds) {
  const releases = builds.filter(function (build) {
    return build.appId === appRecord.id && build.status === "published";
  }).sort(function (a, b) {
    return String(b.publishedAt || b.createdAt).localeCompare(String(a.publishedAt || a.createdAt));
  });
  return {
    id: appRecord.id,
    name: appRecord.name,
    slug: appRecord.slug,
    description: appRecord.description,
    category: appRecord.category,
    icon: appRecord.icon || "",
    website: appRecord.website || "",
    status: appRecord.status,
    createdAt: appRecord.createdAt,
    updatedAt: appRecord.updatedAt,
    latestBuild: releases.length ? publicBuild(releases[0]) : null,
    builds: releases.map(publicBuild)
  };
}

function safeUploadPath(fileName) {
  const candidate = path.resolve(UPLOAD_DIR, path.basename(String(fileName || "")));
  if (!candidate.startsWith(UPLOAD_DIR + path.sep)) throw new Error("Invalid file path");
  return candidate;
}

const upload = multer({
  storage: multer.diskStorage({
    destination: function (req, file, callback) { callback(null, UPLOAD_DIR); },
    filename: function (req, file, callback) {
      const extension = path.extname(file.originalname || "").toLowerCase();
      callback(null, crypto.randomUUID() + extension);
    }
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: function (req, file, callback) {
    const extension = path.extname(file.originalname || "").toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(extension)) return callback(new Error("Unsupported package type. Allowed: APK, AAB, IPA, ZIP, 7Z, EXE, MSI, DMG, PKG, AppImage, DEB, RPM, TAR, GZ."));
    callback(null, true);
  }
});

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:", "https:"],
      styleSrc: ["'self'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'", "https:"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use(function (req, res, next) {
  cors({
    origin: function (origin, callback) {
      const allowed = isOriginAllowed(origin, req);
      callback(allowed ? null : new Error("Origin not allowed"), allowed);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Requested-With"]
  })(req, res, next);
});
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/api/health", function (req, res) {
  res.json({ ok: true, service: "app-downloader-server", time: new Date().toISOString() });
});

app.get("/api/stats/public", async function (req, res, next) {
  try {
    const db = await readDb();
    const publishedBuilds = db.builds.filter(function (build) { return build.status === "published"; });
    res.set("Cache-Control", "no-store");
    res.json({
      applications: db.apps.filter(function (item) { return item.status === "published"; }).length,
      releases: publishedBuilds.length,
      downloads: Number(db.stats.downloads || 0)
    });
  } catch (error) { next(error); }
});

app.get("/api/apps", async function (req, res, next) {
  try {
    const db = await readDb();
    const query = cleanText(req.query.q, 100).toLowerCase();
    const category = cleanText(req.query.category, 60).toLowerCase();
    const apps = db.apps.filter(function (item) {
      if (item.status !== "published") return false;
      if (category && category !== "all" && String(item.category || "").toLowerCase() !== category) return false;
      if (query && !(String(item.name) + " " + String(item.description) + " " + String(item.category)).toLowerCase().includes(query)) return false;
      return true;
    }).map(function (item) { return publicApp(item, db.builds); });
    res.set("Cache-Control", "no-store");
    res.json({ apps: apps });
  } catch (error) { next(error); }
});

app.get("/api/apps/:appId", async function (req, res, next) {
  try {
    const db = await readDb();
    const item = db.apps.find(function (entry) { return entry.id === req.params.appId && entry.status === "published"; });
    if (!item) return res.status(404).json({ error: "Application not found" });
    res.json({ app: publicApp(item, db.builds) });
  } catch (error) { next(error); }
});

app.get("/api/download/:buildId", async function (req, res, next) {
  try {
    let selected;
    await mutateDb(async function (db) {
      selected = db.builds.find(function (entry) { return entry.id === req.params.buildId && entry.status === "published"; });
      if (!selected) return;
      const appRecord = db.apps.find(function (entry) { return entry.id === selected.appId && entry.status === "published"; });
      if (!appRecord) { selected = null; return; }
      selected.downloadCount = Number(selected.downloadCount || 0) + 1;
      db.stats.downloads = Number(db.stats.downloads || 0) + 1;
    });
    if (!selected) return res.status(404).json({ error: "Published release not found" });
    const filePath = safeUploadPath(selected.fileName);
    await fs.access(filePath);
    res.download(filePath, path.basename(selected.originalName || "application-package"), function (error) {
      if (error && !res.headersSent) res.status(500).json({ error: "Unable to download package" });
    });
  } catch (error) {
    if (error.code === "ENOENT") return res.status(404).json({ error: "Release file is missing. Contact the publisher." });
    next(error);
  }
});

app.post("/api/license/verify", async function (req, res, next) {
  try {
    const code = cleanText(req.body && req.body.code, 160).toUpperCase();
    if (!code) return res.status(400).json({ valid: false, error: "License code is required" });
    const db = await readDb();
    const license = db.licenses.find(function (entry) { return entry.code === code; });
    const expired = license && license.expiresAt && new Date(license.expiresAt).getTime() < Date.now();
    if (!license || license.status !== "active" || expired) return res.status(200).json({ valid: false, error: "License is invalid, inactive, or expired" });
    res.json({ valid: true, appId: license.appId || null, expiresAt: license.expiresAt || null });
  } catch (error) { next(error); }
});

app.post("/api/admin/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false }), requireTrustedOrigin, function (req, res) {
  const username = cleanText(req.body && req.body.username, 120);
  const password = String((req.body && req.body.password) || "");
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !SESSION_SECRET) {
    return res.status(503).json({ error: "Admin credentials are not configured on the server" });
  }
  const valid = safeEqual(username, ADMIN_USERNAME) && safeEqual(password, ADMIN_PASSWORD);
  if (!valid) return res.status(401).json({ error: "Incorrect username or password" });
  res.cookie(SESSION_COOKIE, createSessionToken(username), cookieOptions(req));
  res.json({ ok: true, user: { username: username }, expiresInHours: SESSION_HOURS });
});

app.use("/api/admin", requireAdmin);

app.get("/api/admin/me", function (req, res) {
  res.json({ user: req.admin });
});

app.post("/api/admin/logout", requireTrustedOrigin, function (req, res) {
  res.clearCookie(SESSION_COOKIE, Object.assign({}, cookieOptions(req), { maxAge: undefined }));
  res.json({ ok: true });
});

app.get("/api/admin/overview", async function (req, res, next) {
  try {
    const db = await readDb();
    res.json({
      stats: db.stats,
      apps: db.apps.length,
      publishedApps: db.apps.filter(function (item) { return item.status === "published"; }).length,
      builds: db.builds.length,
      publishedBuilds: db.builds.filter(function (item) { return item.status === "published"; }).length,
      licenses: db.licenses.length,
      activeLicenses: db.licenses.filter(function (item) { return item.status === "active"; }).length,
      auditLog: db.auditLog.slice(0, 12)
    });
  } catch (error) { next(error); }
});

app.get("/api/admin/apps", async function (req, res, next) {
  try {
    const db = await readDb();
    res.json({ apps: db.apps.map(function (item) {
      return Object.assign({}, item, { buildCount: db.builds.filter(function (build) { return build.appId === item.id; }).length });
    }) });
  } catch (error) { next(error); }
});

app.post("/api/admin/apps", requireTrustedOrigin, async function (req, res, next) {
  try {
    const name = cleanText(req.body && req.body.name, 100);
    const description = cleanText(req.body && req.body.description, 1000);
    const category = cleanText(req.body && req.body.category, 60) || "Tools";
    if (name.length < 2) return res.status(400).json({ error: "Application name must contain at least 2 characters" });
    const appRecord = {
      id: id(),
      name: name,
      slug: slugify((req.body && req.body.slug) || name) || "app-" + id().slice(0, 8),
      description: description,
      category: category,
      icon: cleanText(req.body && req.body.icon, 500),
      website: cleanText(req.body && req.body.website, 300),
      status: "draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    await mutateDb(async function (db) {
      if (db.apps.some(function (item) { return item.slug === appRecord.slug; })) throw Object.assign(new Error("An application with this slug already exists"), { statusCode: 409 });
      db.apps.unshift(appRecord);
      addAudit(db, "app.created", appRecord.name, req.admin.username);
    });
    res.status(201).json({ app: appRecord });
  } catch (error) { next(error); }
});

app.patch("/api/admin/apps/:appId", requireTrustedOrigin, async function (req, res, next) {
  try {
    let updated;
    await mutateDb(async function (db) {
      const item = db.apps.find(function (entry) { return entry.id === req.params.appId; });
      if (!item) throw Object.assign(new Error("Application not found"), { statusCode: 404 });
      if (req.body.name !== undefined) item.name = cleanText(req.body.name, 100) || item.name;
      if (req.body.description !== undefined) item.description = cleanText(req.body.description, 1000);
      if (req.body.category !== undefined) item.category = cleanText(req.body.category, 60) || "Tools";
      if (req.body.icon !== undefined) item.icon = cleanText(req.body.icon, 500);
      if (req.body.website !== undefined) item.website = cleanText(req.body.website, 300);
      if (req.body.status !== undefined) {
        if (!["draft", "published", "archived"].includes(req.body.status)) throw Object.assign(new Error("Invalid application status"), { statusCode: 400 });
        item.status = req.body.status;
      }
      item.updatedAt = new Date().toISOString();
      updated = Object.assign({}, item);
      addAudit(db, "app.updated", item.name + " (" + item.status + ")", req.admin.username);
    });
    res.json({ app: updated });
  } catch (error) { next(error); }
});

app.delete("/api/admin/apps/:appId", requireTrustedOrigin, async function (req, res, next) {
  try {
    const removedFiles = [];
    await mutateDb(async function (db) {
      const item = db.apps.find(function (entry) { return entry.id === req.params.appId; });
      if (!item) throw Object.assign(new Error("Application not found"), { statusCode: 404 });
      const builds = db.builds.filter(function (entry) { return entry.appId === item.id; });
      builds.forEach(function (entry) { removedFiles.push(entry.fileName); });
      db.apps = db.apps.filter(function (entry) { return entry.id !== item.id; });
      db.builds = db.builds.filter(function (entry) { return entry.appId !== item.id; });
      addAudit(db, "app.deleted", item.name, req.admin.username);
    });
    await Promise.all(removedFiles.map(function (file) { return fs.unlink(safeUploadPath(file)).catch(function () {}); }));
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/admin/builds", async function (req, res, next) {
  try {
    const db = await readDb();
    const appsById = new Map(db.apps.map(function (item) { return [item.id, item.name]; }));
    res.json({ builds: db.builds.map(function (item) {
      return Object.assign({}, item, { appName: appsById.get(item.appId) || "Unknown app" });
    }) });
  } catch (error) { next(error); }
});

app.post("/api/admin/apps/:appId/builds", requireTrustedOrigin, function (req, res, next) {
  upload.single("package")(req, res, async function (uploadError) {
    if (uploadError) {
      const tooLarge = uploadError.code === "LIMIT_FILE_SIZE";
      return res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? "Package exceeds MAX_UPLOAD_MB" : uploadError.message || "Could not upload package" });
    }
    if (!req.file) return res.status(400).json({ error: "Choose a package file to upload" });
    try {
      const dbBefore = await readDb();
      const appRecord = dbBefore.apps.find(function (item) { return item.id === req.params.appId; });
      if (!appRecord) {
        await fs.unlink(req.file.path).catch(function () {});
        return res.status(404).json({ error: "Application not found" });
      }
      const hash = crypto.createHash("sha256");
      await new Promise(function (resolve, reject) {
        const stream = fsSync.createReadStream(req.file.path);
        stream.on("data", function (chunk) { hash.update(chunk); });
        stream.on("error", reject);
        stream.on("end", resolve);
      });
      const version = cleanText(req.body.version, 40);
      if (!version) {
        await fs.unlink(req.file.path).catch(function () {});
        return res.status(400).json({ error: "Version is required, for example 1.0.0" });
      }
      const build = {
        id: id(),
        appId: appRecord.id,
        version: version,
        platform: cleanText(req.body.platform, 40) || "Universal",
        architecture: cleanText(req.body.architecture, 40) || "Universal",
        originalName: path.basename(req.file.originalname).slice(0, 180),
        fileName: path.basename(req.file.filename),
        size: req.file.size,
        checksum: hash.digest("hex"),
        releaseNotes: cleanText(req.body.releaseNotes, 3000),
        status: "draft",
        downloadCount: 0,
        createdAt: new Date().toISOString(),
        publishedAt: null
      };
      await mutateDb(async function (db) {
        if (!db.apps.some(function (item) { return item.id === appRecord.id; })) throw Object.assign(new Error("Application not found"), { statusCode: 404 });
        db.builds.unshift(build);
        db.stats.uploads = Number(db.stats.uploads || 0) + 1;
        addAudit(db, "build.uploaded", appRecord.name + " " + build.version, req.admin.username);
      });
      res.status(201).json({ build: build });
    } catch (error) {
      await fs.unlink(req.file.path).catch(function () {});
      next(error);
    }
  });
});

app.patch("/api/admin/builds/:buildId", requireTrustedOrigin, async function (req, res, next) {
  try {
    let updated;
    await mutateDb(async function (db) {
      const item = db.builds.find(function (entry) { return entry.id === req.params.buildId; });
      if (!item) throw Object.assign(new Error("Build not found"), { statusCode: 404 });
      if (req.body.status !== undefined) {
        if (!["draft", "published", "archived"].includes(req.body.status)) throw Object.assign(new Error("Invalid build status"), { statusCode: 400 });
        if (req.body.status === "published") {
          const appRecord = db.apps.find(function (entry) { return entry.id === item.appId; });
          if (!appRecord) throw Object.assign(new Error("Application not found"), { statusCode: 404 });
          item.publishedAt = new Date().toISOString();
          appRecord.status = "published";
          appRecord.updatedAt = item.publishedAt;
        }
        item.status = req.body.status;
      }
      if (req.body.releaseNotes !== undefined) item.releaseNotes = cleanText(req.body.releaseNotes, 3000);
      updated = Object.assign({}, item);
      const parent = db.apps.find(function (entry) { return entry.id === item.appId; });
      addAudit(db, "build.updated", (parent ? parent.name : "App") + " " + item.version + " (" + item.status + ")", req.admin.username);
    });
    res.json({ build: updated });
  } catch (error) { next(error); }
});

app.delete("/api/admin/builds/:buildId", requireTrustedOrigin, async function (req, res, next) {
  try {
    let fileName;
    await mutateDb(async function (db) {
      const item = db.builds.find(function (entry) { return entry.id === req.params.buildId; });
      if (!item) throw Object.assign(new Error("Build not found"), { statusCode: 404 });
      fileName = item.fileName;
      db.builds = db.builds.filter(function (entry) { return entry.id !== item.id; });
      addAudit(db, "build.deleted", item.originalName, req.admin.username);
    });
    await fs.unlink(safeUploadPath(fileName)).catch(function () {});
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.get("/api/admin/licenses", async function (req, res, next) {
  try {
    const db = await readDb();
    const appsById = new Map(db.apps.map(function (item) { return [item.id, item.name]; }));
    res.json({ licenses: db.licenses.map(function (item) {
      return Object.assign({}, item, { appName: appsById.get(item.appId) || "All applications" });
    }) });
  } catch (error) { next(error); }
});

app.post("/api/admin/licenses", requireTrustedOrigin, async function (req, res, next) {
  try {
    const appId = cleanText(req.body.appId, 80) || null;
    const expiresAt = cleanText(req.body.expiresAt, 40) || null;
    const maxActivations = Math.max(1, Math.min(100000, Number(req.body.maxActivations || 1)));
    if (appId) {
      const db = await readDb();
      if (!db.apps.some(function (item) { return item.id === appId; })) return res.status(400).json({ error: "Selected application does not exist" });
    }
    if (expiresAt && !Number.isFinite(new Date(expiresAt).getTime())) return res.status(400).json({ error: "Invalid expiry date" });
    const license = {
      id: id(),
      code: "HND-" + crypto.randomBytes(4).toString("hex").toUpperCase() + "-" + crypto.randomBytes(4).toString("hex").toUpperCase(),
      appId: appId,
      status: "active",
      maxActivations: maxActivations,
      activations: 0,
      expiresAt: expiresAt,
      createdAt: new Date().toISOString()
    };
    await mutateDb(async function (db) {
      db.licenses.unshift(license);
      addAudit(db, "license.created", license.code, req.admin.username);
    });
    res.status(201).json({ license: license });
  } catch (error) { next(error); }
});

app.patch("/api/admin/licenses/:licenseId", requireTrustedOrigin, async function (req, res, next) {
  try {
    let updated;
    await mutateDb(async function (db) {
      const item = db.licenses.find(function (entry) { return entry.id === req.params.licenseId; });
      if (!item) throw Object.assign(new Error("License not found"), { statusCode: 404 });
      if (req.body.status !== undefined) {
        if (!["active", "revoked", "suspended"].includes(req.body.status)) throw Object.assign(new Error("Invalid license status"), { statusCode: 400 });
        item.status = req.body.status;
      }
      updated = Object.assign({}, item);
      addAudit(db, "license.updated", item.code + " (" + item.status + ")", req.admin.username);
    });
    res.json({ license: updated });
  } catch (error) { next(error); }
});

app.get("/api/admin/audit", async function (req, res, next) {
  try {
    const db = await readDb();
    res.json({ entries: db.auditLog });
  } catch (error) { next(error); }
});

app.use("/api", function (req, res) {
  res.status(404).json({ error: "API endpoint not found" });
});

app.use(express.static(PUBLIC_DIR, {
  extensions: ["html"],
  maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  setHeaders: function (res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
  }
}));

app.get("*", function (req, res) {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "API endpoint not found" });
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.use(function (error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = Number(error.statusCode) || (error.message === "Origin not allowed" ? 403 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? "Internal server error" : error.message });
});

async function startServer() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || SESSION_SECRET.length < 32) {
    throw new Error("Configure ADMIN_USERNAME, ADMIN_PASSWORD, and SESSION_SECRET (at least 32 characters) before starting the server. See .env.example.");
  }
  await ensureStorage();
  const port = Number(process.env.PORT || 3000);
  return app.listen(port, "0.0.0.0", function () {
    console.log("App Downloader Server listening on port " + port);
  });
}

if (require.main === module) {
  let httpServer;
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Received " + signal + "; closing HTTP server...");
    if (!httpServer) return process.exit(0);

    const forceExit = setTimeout(function () {
      console.error("Graceful shutdown timed out; forcing exit.");
      process.exit(1);
    }, 25000);
    forceExit.unref();

    httpServer.close(function () {
      clearTimeout(forceExit);
      console.log("HTTP server closed.");
      process.exit(0);
    });
  }

  process.once("SIGTERM", function () { shutdown("SIGTERM"); });
  process.once("SIGINT", function () { shutdown("SIGINT"); });

  startServer().then(function (server) {
    httpServer = server;
  }).catch(function (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  });
}

module.exports = { app: app, startServer: startServer, ensureStorage: ensureStorage };
