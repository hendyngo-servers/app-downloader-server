(function () {
  "use strict";

  const API_BASE = String((window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "").replace(/\/+$/, "");
  const state = { page: "overview", apps: [], builds: [], licenses: [], currentUser: null };
  const byId = function (id) { return document.getElementById(id); };

  function apiUrl(path) { return API_BASE + path; }

  async function request(path, options) {
    const opts = Object.assign({ method: "GET", credentials: "include" }, options || {});
    opts.headers = Object.assign({}, opts.headers || {});
    if (opts.body && !(opts.body instanceof FormData) && !opts.headers["Content-Type"]) opts.headers["Content-Type"] = "application/json";
    const response = await fetch(apiUrl(path), opts);
    let body = {};
    if ((response.headers.get("content-type") || "").includes("application/json")) body = await response.json();
    if (!response.ok) {
      if (response.status === 401 && path !== "/api/admin/login") showLogin();
      throw new Error(body.error || "Yêu cầu không thành công (" + response.status + ")");
    }
    return body;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function formObject(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  function showToast(message, isError) {
    const region = byId("toast-region");
    const node = document.createElement("div");
    node.className = "toast" + (isError ? " error" : "");
    node.textContent = message;
    region.appendChild(node);
    window.setTimeout(function () { node.remove(); }, 4500);
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function formatSize(value) {
    const size = Number(value || 0);
    if (!size) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    return (size / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1) + " " + units[index];
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
  }

  function statusTag(status) {
    const safe = String(status || "draft").toLowerCase();
    const label = ({ published: "PUBLISHED", draft: "DRAFT", archived: "ARCHIVED", active: "ACTIVE", revoked: "REVOKED", suspended: "SUSPENDED" })[safe] || safe.toUpperCase();
    return '<span class="table-tag status-' + escapeHtml(safe) + '">' + escapeHtml(label) + '</span>';
  }

  function actionButton(label, action, id, danger) {
    return '<button class="table-action' + (danger ? " danger" : "") + '" data-action="' + escapeHtml(action) + '" data-id="' + escapeHtml(id) + '">' + escapeHtml(label) + '</button>';
  }

  function showLogin() {
    byId("admin-shell").hidden = true;
    byId("login-stage").hidden = false;
    state.currentUser = null;
  }

  function showDashboard(user) {
    state.currentUser = user || { username: "Developer" };
    byId("login-stage").hidden = true;
    byId("admin-shell").hidden = false;
    byId("admin-user").textContent = state.currentUser.username || "Developer";
    byId("admin-avatar").textContent = String(state.currentUser.username || "D").slice(0, 1).toUpperCase();
    navigate(state.page || "overview");
    loadOverview();
    loadApps();
    loadBuilds();
    loadLicenses();
  }

  async function checkSession() {
    try {
      const result = await request("/api/admin/me");
      showDashboard(result.user);
    } catch (error) {
      showLogin();
    }
  }

  async function login(event) {
    event.preventDefault();
    const form = byId("login-form");
    const button = form.querySelector("button[type=submit]");
    const message = byId("login-message");
    message.textContent = "";
    button.disabled = true;
    button.textContent = "Đang xác thực...";
    try {
      const result = await request("/api/admin/login", { method: "POST", body: JSON.stringify(formObject(form)) });
      form.reset();
      showDashboard(result.user);
      showToast("Đăng nhập thành công.");
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
      button.innerHTML = 'Xác thực truy cập <span>↗</span>';
    }
  }

  async function logout() {
    try { await request("/api/admin/logout", { method: "POST", body: "{}" }); }
    catch (error) { /* Clear the local view even if the session is already expired. */ }
    showLogin();
    showToast("Đã đăng xuất.");
  }

  function navigate(page) {
    if (!document.getElementById("page-" + page)) page = "overview";
    state.page = page;
    document.querySelectorAll(".admin-page").forEach(function (section) {
      section.classList.toggle("is-current", section.id === "page-" + page);
    });
    document.querySelectorAll(".admin-nav-item").forEach(function (button) {
      button.classList.toggle("is-active", button.dataset.page === page);
    });
    const names = { overview: "Tổng quan", apps: "Ứng dụng", builds: "Bản build", licenses: "License", audit: "Nhật ký hoạt động" };
    byId("breadcrumb-current").textContent = names[page] || names.overview;
  }

  async function loadOverview() {
    try {
      const data = await request("/api/admin/overview");
      const stats = data.stats || {};
      const values = [
        { label: "APPLICATIONS", value: data.apps, detail: formatNumber(data.publishedApps) + " ứng dụng công khai" },
        { label: "RELEASES", value: data.builds, detail: formatNumber(data.publishedBuilds) + " bản đã xuất bản" },
        { label: "TOTAL DOWNLOADS", value: stats.downloads, detail: formatNumber(stats.uploads) + " gói đã upload" },
        { label: "ACTIVE LICENSES", value: data.activeLicenses, detail: formatNumber(data.licenses) + " license tổng cộng" }
      ];
      byId("overview-stats").innerHTML = values.map(function (item) {
        return '<div class="overview-stat"><small>' + escapeHtml(item.label) + '</small><strong>' + formatNumber(item.value) + '</strong><span>' + escapeHtml(item.detail) + '</span></div>';
      }).join("");
      renderActivity(data.auditLog || [], "recent-activity");
    } catch (error) { showToast(error.message, true); }
  }

  function renderActivity(entries, targetId) {
    const target = byId(targetId);
    if (!entries.length) {
      target.innerHTML = '<div class="empty-state">Chưa có hoạt động. Các thao tác quản trị sẽ xuất hiện ở đây.</div>';
      return;
    }
    target.innerHTML = entries.map(function (entry) {
      const marker = String(entry.action || "event").split(".")[0];
      const glyph = marker === "build" ? "⇧" : marker === "license" ? "⚿" : marker === "app" ? "◈" : "≋";
      const detail = [entry.actor || "system", formatDateTime(entry.createdAt)].filter(Boolean).join(" · ");
      return '<div class="activity-row"><span class="activity-marker">' + glyph + '</span><div class="activity-copy"><b>' + escapeHtml(entry.detail || entry.action || "System event") + '</b><small>' + escapeHtml(entry.action || "event") + ' · ' + escapeHtml(entry.actor || "system") + '</small></div><time class="activity-time">' + escapeHtml(formatDateTime(entry.createdAt)) + '</time></div>';
    }).join("");
  }

  function fillAppSelects() {
    const options = state.apps.map(function (app) {
      return '<option value="' + escapeHtml(app.id) + '">' + escapeHtml(app.name) + ' — ' + escapeHtml(app.status) + '</option>';
    }).join("");
    byId("build-app").innerHTML = '<option value="">Chọn project...</option>' + state.apps.map(function (app) {
      return '<option value="' + escapeHtml(app.id) + '">' + escapeHtml(app.name) + ' — ' + escapeHtml(app.status) + '</option>';
    }).join("");
    byId("license-app").innerHTML = '<option value="">Tất cả ứng dụng</option>' + options;
  }

  function renderApps() {
    byId("apps-count").textContent = state.apps.length + " PROJECTS";
    const target = byId("apps-table");
    if (!state.apps.length) {
      target.innerHTML = '<tr><td colspan="5" class="table-empty">Chưa có ứng dụng. Bấm “Tạo ứng dụng” để bắt đầu.</td></tr>';
      return;
    }
    target.innerHTML = state.apps.map(function (app) {
      let actions = actionButton("Sửa mô tả", "edit-app", app.id, false);
      if (app.status === "published") actions += actionButton("Ẩn", "hide-app", app.id, false);
      else actions += actionButton("Publish", "publish-app", app.id, false);
      actions += actionButton("Xóa", "delete-app", app.id, true);
      return '<tr><td><span class="table-primary">' + escapeHtml(app.name) + '</span><span class="table-secondary">' + escapeHtml(app.slug) + '</span></td>' +
        '<td><span class="table-tag">' + escapeHtml(app.category || "Tools") + '</span></td><td>' + formatNumber(app.buildCount) + '</td><td>' + statusTag(app.status) + '</td><td><div class="row-actions">' + actions + '</div></td></tr>';
    }).join("");
  }

  async function loadApps() {
    try {
      const result = await request("/api/admin/apps");
      state.apps = Array.isArray(result.apps) ? result.apps : [];
      fillAppSelects();
      renderApps();
    } catch (error) {
      if (error.message !== "Admin login required") showToast(error.message, true);
    }
  }

  function renderBuilds() {
    byId("builds-count").textContent = state.builds.length + " BUILDS";
    const target = byId("builds-table");
    if (!state.builds.length) {
      target.innerHTML = '<tr><td colspan="6" class="table-empty">Chưa có build. Tạo ứng dụng trước, sau đó upload gói phát hành.</td></tr>';
      return;
    }
    target.innerHTML = state.builds.map(function (build) {
      let actions = "";
      if (build.status === "published") actions += actionButton("Unpublish", "unpublish-build", build.id, false);
      else if (build.status === "draft") actions += actionButton("Publish", "publish-build", build.id, false);
      actions += actionButton("Xóa", "delete-build", build.id, true);
      return '<tr><td><span class="table-primary">v' + escapeHtml(build.version) + '</span><span class="table-secondary">' + escapeHtml(build.originalName || build.fileName) + ' · ' + formatSize(build.size) + '</span></td>' +
        '<td><span class="table-primary">' + escapeHtml(build.appName || "Unknown app") + '</span><span class="table-secondary">' + escapeHtml(formatDate(build.createdAt)) + '</span></td>' +
        '<td><span class="table-tag">' + escapeHtml(build.platform || "Universal") + '</span><span class="table-secondary">' + escapeHtml(build.architecture || "Universal") + '</span></td>' +
        '<td><span class="checksum" title="' + escapeHtml(build.checksum) + '">' + escapeHtml(String(build.checksum || "").slice(0, 16)) + '…</span></td>' +
        '<td>' + statusTag(build.status) + '</td><td><div class="row-actions">' + actions + '</div></td></tr>';
    }).join("");
  }

  async function loadBuilds() {
    try {
      const result = await request("/api/admin/builds");
      state.builds = Array.isArray(result.builds) ? result.builds : [];
      renderBuilds();
    } catch (error) {
      if (error.message !== "Admin login required") showToast(error.message, true);
    }
  }

  function renderLicenses() {
    byId("licenses-count").textContent = state.licenses.length + " LICENSES";
    const target = byId("licenses-table");
    if (!state.licenses.length) {
      target.innerHTML = '<tr><td colspan="6" class="table-empty">Chưa có license. Tạo mã mới để bắt đầu quản lý quyền sử dụng.</td></tr>';
      return;
    }
    target.innerHTML = state.licenses.map(function (license) {
      const actions = license.status === "active"
        ? actionButton("Thu hồi", "revoke-license", license.id, true)
        : actionButton("Kích hoạt", "activate-license", license.id, false);
      return '<tr><td><span class="license-code">' + escapeHtml(license.code) + '</span><span class="table-secondary">Created ' + escapeHtml(formatDate(license.createdAt)) + '</span></td>' +
        '<td><span class="table-primary">' + escapeHtml(license.appName || "All applications") + '</span></td>' +
        '<td>' + formatNumber(license.activations) + ' / ' + formatNumber(license.maxActivations) + '</td>' +
        '<td>' + escapeHtml(license.expiresAt ? formatDate(license.expiresAt) : "Không giới hạn") + '</td>' +
        '<td>' + statusTag(license.status) + '</td><td><div class="row-actions">' + actions + '</div></td></tr>';
    }).join("");
  }

  async function loadLicenses() {
    try {
      const result = await request("/api/admin/licenses");
      state.licenses = Array.isArray(result.licenses) ? result.licenses : [];
      renderLicenses();
    } catch (error) {
      if (error.message !== "Admin login required") showToast(error.message, true);
    }
  }

  async function loadAudit() {
    try {
      const result = await request("/api/admin/audit");
      renderActivity(result.entries || [], "audit-list");
    } catch (error) {
      if (error.message !== "Admin login required") showToast(error.message, true);
    }
  }

  function setPanel(panelId, visible) {
    byId(panelId).hidden = !visible;
    if (visible) byId(panelId).scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function createApp(event) {
    event.preventDefault();
    const form = byId("create-app-form");
    const data = formObject(form);
    try {
      const result = await request("/api/admin/apps", { method: "POST", body: JSON.stringify(data) });
      form.reset();
      setPanel("create-app-panel", false);
      await loadApps();
      await loadOverview();
      showToast("Đã tạo ứng dụng: " + result.app.name);
    } catch (error) { showToast(error.message, true); }
  }

  function uploadBuild(event) {
    event.preventDefault();
    const form = byId("upload-build-form");
    const file = byId("build-package").files[0];
    if (!file) { showToast("Hãy chọn gói phần mềm cần upload.", true); return; }
    const appId = byId("build-app").value;
    if (!appId) { showToast("Hãy chọn ứng dụng trước khi upload.", true); return; }
    const formData = new FormData(form);
    const progress = byId("upload-progress");
    const progressBar = byId("upload-progress-bar");
    const percent = byId("upload-progress-percent");
    const label = byId("upload-progress-label");
    const submit = form.querySelector('button[type="submit"]');
    progress.hidden = false;
    submit.disabled = true;
    label.textContent = "Đang upload " + file.name;
    percent.textContent = "0%";
    progressBar.style.width = "0%";
    const xhr = new XMLHttpRequest();
    xhr.open("POST", apiUrl("/api/admin/apps/" + encodeURIComponent(appId) + "/builds"));
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (event) {
      if (!event.lengthComputable) return;
      const value = Math.round((event.loaded / event.total) * 100);
      percent.textContent = value + "%";
      progressBar.style.width = value + "%";
      label.textContent = value === 100 ? "Đang xác minh file..." : "Đang upload " + file.name;
    };
    xhr.onload = async function () {
      let body = {};
      try { body = JSON.parse(xhr.responseText || "{}"); } catch (error) {}
      if (xhr.status >= 200 && xhr.status < 300) {
        form.reset();
        setPanel("upload-build-panel", false);
        showToast("Đã upload bản build. Hãy publish sau khi kiểm tra.");
        await loadBuilds();
        await loadApps();
        await loadOverview();
        navigate("builds");
      } else {
        if (xhr.status === 401) showLogin();
        showToast(body.error || "Upload thất bại.", true);
      }
      submit.disabled = false;
      progress.hidden = true;
    };
    xhr.onerror = function () {
      submit.disabled = false;
      progress.hidden = true;
      showToast("Lỗi kết nối trong khi upload. Kiểm tra API và thử lại.", true);
    };
    xhr.send(formData);
  }

  async function createLicense(event) {
    event.preventDefault();
    const data = formObject(byId("create-license-form"));
    if (data.expiresAt) data.expiresAt = new Date(data.expiresAt + "T23:59:59.000Z").toISOString();
    data.maxActivations = Number(data.maxActivations || 1);
    try {
      const result = await request("/api/admin/licenses", { method: "POST", body: JSON.stringify(data) });
      byId("create-license-form").reset();
      setPanel("create-license-panel", false);
      await loadLicenses();
      await loadOverview();
      showToast("Đã tạo license: " + result.license.code);
      window.prompt("Sao chép mã license mới:", result.license.code);
    } catch (error) { showToast(error.message, true); }
  }

  async function handleAction(action, entityId) {
    const app = state.apps.find(function (item) { return item.id === entityId; });
    const build = state.builds.find(function (item) { return item.id === entityId; });
    const license = state.licenses.find(function (item) { return item.id === entityId; });
    try {
      if (action === "publish-app" || action === "hide-app") {
        if (!app) return;
        const next = action === "publish-app" ? "published" : "draft";
        await request("/api/admin/apps/" + encodeURIComponent(entityId), { method: "PATCH", body: JSON.stringify({ status: next }) });
        await loadApps();
        await loadOverview();
        showToast(next === "published" ? "Ứng dụng đã được đặt công khai." : "Ứng dụng đã được chuyển về Draft.");
      } else if (action === "edit-app") {
        if (!app) return;
        const description = window.prompt("Mô tả ứng dụng:", app.description || "");
        if (description === null) return;
        const category = window.prompt("Danh mục:", app.category || "Tools");
        if (category === null) return;
        await request("/api/admin/apps/" + encodeURIComponent(entityId), { method: "PATCH", body: JSON.stringify({ description: description, category: category }) });
        await loadApps();
        showToast("Đã cập nhật thông tin ứng dụng.");
      } else if (action === "delete-app") {
        if (!app || !window.confirm("Xóa ứng dụng " + app.name + " cùng toàn bộ build đã lưu?")) return;
        await request("/api/admin/apps/" + encodeURIComponent(entityId), { method: "DELETE" });
        await loadApps(); await loadBuilds(); await loadOverview();
        showToast("Đã xóa ứng dụng và các build liên quan.");
      } else if (action === "publish-build" || action === "unpublish-build") {
        if (!build) return;
        const next = action === "publish-build" ? "published" : "draft";
        if (next === "published" && !window.confirm("Xuất bản v" + build.version + "? Gói này sẽ được hiển thị để tải xuống.")) return;
        await request("/api/admin/builds/" + encodeURIComponent(entityId), { method: "PATCH", body: JSON.stringify({ status: next }) });
        await loadBuilds(); await loadApps(); await loadOverview();
        showToast(next === "published" ? "Release đã được xuất bản." : "Release đã chuyển về Draft.");
      } else if (action === "delete-build") {
        if (!build || !window.confirm("Xóa v" + build.version + " và file package này?")) return;
        await request("/api/admin/builds/" + encodeURIComponent(entityId), { method: "DELETE" });
        await loadBuilds(); await loadOverview();
        showToast("Đã xóa bản build.");
      } else if (action === "revoke-license" || action === "activate-license") {
        if (!license) return;
        const next = action === "revoke-license" ? "revoked" : "active";
        await request("/api/admin/licenses/" + encodeURIComponent(entityId), { method: "PATCH", body: JSON.stringify({ status: next }) });
        await loadLicenses(); await loadOverview();
        showToast(next === "revoked" ? "Đã thu hồi license." : "Đã kích hoạt lại license.");
      }
    } catch (error) { showToast(error.message, true); }
  }

  function bindEvents() {
    byId("login-form").addEventListener("submit", login);
    byId("logout-button").addEventListener("click", logout);
    document.querySelectorAll(".admin-nav-item").forEach(function (button) {
      button.addEventListener("click", function () {
        navigate(button.dataset.page);
        if (state.page === "overview") loadOverview();
        if (state.page === "apps") loadApps();
        if (state.page === "builds") { loadBuilds(); loadApps(); }
        if (state.page === "licenses") { loadLicenses(); loadApps(); }
        if (state.page === "audit") loadAudit();
      });
    });
    document.querySelectorAll("[data-goto]").forEach(function (button) {
      button.addEventListener("click", function () {
        navigate(button.dataset.goto);
        if (state.page === "apps") loadApps();
        if (state.page === "builds") { loadBuilds(); loadApps(); }
        if (state.page === "licenses") { loadLicenses(); loadApps(); }
        if (state.page === "audit") loadAudit();
      });
    });
    byId("open-create-app").addEventListener("click", function () { setPanel("create-app-panel", true); });
    byId("close-create-app").addEventListener("click", function () { setPanel("create-app-panel", false); });
    byId("open-upload-build").addEventListener("click", function () { loadApps(); setPanel("upload-build-panel", true); });
    byId("close-upload-build").addEventListener("click", function () { setPanel("upload-build-panel", false); });
    byId("open-create-license").addEventListener("click", function () { loadApps(); setPanel("create-license-panel", true); });
    byId("close-create-license").addEventListener("click", function () { setPanel("create-license-panel", false); });
    byId("create-app-form").addEventListener("submit", createApp);
    byId("upload-build-form").addEventListener("submit", uploadBuild);
    byId("create-license-form").addEventListener("submit", createLicense);
    byId("refresh-overview").addEventListener("click", loadOverview);
    byId("refresh-audit").addEventListener("click", loadAudit);
    document.addEventListener("click", function (event) {
      const button = event.target.closest("[data-action]");
      if (button) handleAction(button.dataset.action, button.dataset.id);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    bindEvents();
    checkSession();
  });
})();
