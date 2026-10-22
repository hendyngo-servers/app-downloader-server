const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

let server;
let baseUrl;
let cookie;
let scratchDir;
let appId;
let buildId;
let licenseCode;

test("App Downloader Server end-to-end smoke test", async function (t) {
  scratchDir = await fs.mkdtemp(path.join(os.tmpdir(), "app-downloader-test-"));
  process.env.NODE_ENV = "test";
  process.env.ADMIN_USERNAME = "test-developer";
  process.env.ADMIN_PASSWORD = "test-password-strong";
  process.env.SESSION_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";
  process.env.COOKIE_SAME_SITE = "lax";
  process.env.CORS_ORIGINS = "";
  process.env.DATA_FILE = path.join(scratchDir, "data.json");
  process.env.UPLOAD_DIR = path.join(scratchDir, "uploads");

  const service = require("../server.js");
  await service.ensureStorage();
  server = service.app.listen(0, "127.0.0.1");
  await new Promise(function (resolve, reject) {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = "http://127.0.0.1:" + server.address().port;

  await t.test("health endpoint responds", async function () {
    const response = await fetch(baseUrl + "/api/health");
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, "app-downloader-server");
  });

  await t.test("admin APIs reject requests without a session", async function () {
    const response = await fetch(baseUrl + "/api/admin/overview");
    assert.equal(response.status, 401);
  });

  await t.test("login creates an authenticated session", async function () {
    const response = await fetch(baseUrl + "/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "test-developer", password: "test-password-strong" })
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    const setCookie = response.headers.get("set-cookie");
    assert.ok(setCookie && setCookie.includes("appdownloader_admin="));
    cookie = setCookie.split(";")[0];
  });

  await t.test("admin creates an application", async function () {
    const response = await fetch(baseUrl + "/api/admin/apps", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie },
      body: JSON.stringify({
        name: "Smoke Test App",
        description: "Integration-test release package",
        category: "Developer"
      })
    });
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.app.name, "Smoke Test App");
    appId = body.app.id;
  });

  await t.test("admin uploads and publishes a package, users can download it", async function () {
    const form = new FormData();
    form.append("version", "1.0.0");
    form.append("platform", "Universal");
    form.append("architecture", "Universal");
    form.append("releaseNotes", "Smoke test release");
    form.append("package", new Blob(["test package bytes"], { type: "application/zip" }), "sample.zip");
    const uploadResponse = await fetch(baseUrl + "/api/admin/apps/" + encodeURIComponent(appId) + "/builds", {
      method: "POST",
      headers: { cookie: cookie },
      body: form
    });
    const uploadBody = await uploadResponse.json();
    assert.equal(uploadResponse.status, 201);
    assert.equal(uploadBody.build.status, "draft");
    assert.equal(uploadBody.build.checksum, crypto.createHash("sha256").update("test package bytes").digest("hex"));
    buildId = uploadBody.build.id;

    const publishResponse = await fetch(baseUrl + "/api/admin/builds/" + encodeURIComponent(buildId), {
      method: "PATCH",
      headers: { "content-type": "application/json", cookie: cookie },
      body: JSON.stringify({ status: "published" })
    });
    assert.equal(publishResponse.status, 200);

    const catalogResponse = await fetch(baseUrl + "/api/apps");
    const catalog = await catalogResponse.json();
    assert.equal(catalogResponse.status, 200);
    assert.equal(catalog.apps.length, 1);
    assert.equal(catalog.apps[0].latestBuild.version, "1.0.0");

    const downloadResponse = await fetch(baseUrl + "/api/download/" + encodeURIComponent(buildId));
    assert.equal(downloadResponse.status, 200);
    assert.match(downloadResponse.headers.get("content-disposition") || "", /attachment/);
    assert.equal(await downloadResponse.text(), "test package bytes");
  });

  await t.test("license can be created and verified", async function () {
    const createResponse = await fetch(baseUrl + "/api/admin/licenses", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookie },
      body: JSON.stringify({ appId: appId, maxActivations: 3 })
    });
    const created = await createResponse.json();
    assert.equal(createResponse.status, 201);
    licenseCode = created.license.code;

    const verifyResponse = await fetch(baseUrl + "/api/license/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: licenseCode })
    });
    const verification = await verifyResponse.json();
    assert.equal(verifyResponse.status, 200);
    assert.equal(verification.valid, true);
    assert.equal(verification.appId, appId);
  });

  await t.test("overview records release and download activity", async function () {
    const response = await fetch(baseUrl + "/api/admin/overview", { headers: { cookie: cookie } });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.publishedApps, 1);
    assert.equal(body.publishedBuilds, 1);
    assert.equal(body.stats.downloads, 1);
    assert.ok(body.auditLog.length > 0);
  });

  await new Promise(function (resolve) { server.close(resolve); });
  server = null;
  await fs.rm(scratchDir, { recursive: true, force: true });
});

test.after(async function () {
  if (server) await new Promise(function (resolve) { server.close(resolve); });
  if (scratchDir) await fs.rm(scratchDir, { recursive: true, force: true });
});
