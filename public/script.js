(function () {
  "use strict";

  const API_BASE = String((window.APP_CONFIG && window.APP_CONFIG.API_BASE_URL) || "").replace(/\/+$/, "");
  const state = { apps: [], category: "all", query: "", sort: "newest", requestId: 0 };
  const byId = function (id) { return document.getElementById(id); };

  function apiUrl(path) { return API_BASE + path; }

  async function request(path, options) {
    const opts = Object.assign({ method: "GET", credentials: "include" }, options || {});
    opts.headers = Object.assign({}, opts.headers || {});
    if (opts.body && !(opts.body instanceof FormData) && !opts.headers["Content-Type"]) {
      opts.headers["Content-Type"] = "application/json";
    }
    const response = await fetch(apiUrl(path), opts);
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new Error((body && body.error) || "Yêu cầu không thành công (" + response.status + ")");
    return body || {};
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function safeUrl(value) {
    try {
      const parsed = new URL(String(value), window.location.href);
      return (parsed.protocol === "http:" || parsed.protocol === "https:") ? parsed.href : "";
    } catch (error) { return ""; }
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function formatSize(value) {
    const size = Number(value || 0);
    if (size <= 0) return "—";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
    return (size / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1) + " " + units[index];
  }

  function formatDate(value) {
    if (!value) return "Chưa phát hành";
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "—";
    return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  }

  function showToast(message, isError) {
    const region = byId("toast-region");
    if (!region) return;
    const node = document.createElement("div");
    node.className = "toast" + (isError ? " error" : "");
    node.textContent = message;
    region.appendChild(node);
    window.setTimeout(function () { node.remove(); }, 4200);
  }

  function setStats(stats) {
    byId("stat-apps").textContent = formatNumber(stats.applications);
    byId("stat-releases").textContent = formatNumber(stats.releases);
    byId("stat-downloads").textContent = formatNumber(stats.downloads);
  }

  function sortApps(apps) {
    const sorted = apps.slice();
    if (state.sort === "name") sorted.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (state.sort === "downloads") sorted.sort(function (a, b) {
      return Number((b.latestBuild && b.latestBuild.downloadCount) || 0) - Number((a.latestBuild && a.latestBuild.downloadCount) || 0);
    });
    else sorted.sort(function (a, b) {
      return String((b.latestBuild && b.latestBuild.publishedAt) || b.updatedAt || b.createdAt || "")
        .localeCompare(String((a.latestBuild && a.latestBuild.publishedAt) || a.updatedAt || a.createdAt || ""));
    });
    return sorted;
  }

  function renderAppCard(app) {
    const latest = app.latestBuild;
    const image = safeUrl(app.icon);
    const icon = image
      ? '<span class="app-icon"><img src="' + escapeHtml(image) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></span>'
      : '<span class="app-icon">' + escapeHtml((app.name || "A").trim().slice(0, 1).toUpperCase()) + '</span>';
    const version = latest ? "v" + escapeHtml(latest.version) : "NO RELEASE";
    const platform = latest ? escapeHtml(latest.platform || "Universal") : "Chưa có bản build";
    const fileSize = latest ? formatSize(latest.size) : "—";
    const downloadCount = latest ? formatNumber(latest.downloadCount) + " DOWNLOADS" : "DRAFT PROJECT";
    const button = latest
      ? '<a class="download-button" href="' + escapeHtml(apiUrl(latest.downloadUrl)) + '" rel="nofollow" download>⇩ Tải xuống <span>↗</span></a>'
      : '<span class="app-no-release">Chưa có bản phát hành</span>';
    return '<article class="app-card">' +
      '<div class="app-card-head">' + icon + '<div class="app-card-title"><h3>' + escapeHtml(app.name) + '</h3><span class="app-category">' + escapeHtml(app.category || "Tools") + '</span></div><span class="app-status"><i></i> VERIFIED</span></div>' +
      '<p class="app-description">' + escapeHtml(app.description || "Ứng dụng được quản lý và phân phối qua Hendy Hub.") + '</p>' +
      '<div class="app-meta-row"><span>' + platform + '</span><i class="app-meta-dot"></i><span>' + fileSize + '</span><i class="app-meta-dot"></i><span>' + downloadCount + '</span></div>' +
      '<div class="app-card-footer"><span class="app-version">' + version + '</span>' + button + '</div>' +
      (latest && latest.checksum ? '<div class="app-meta-row"><span>SHA-256</span><span title="' + escapeHtml(latest.checksum) + '">' + escapeHtml(latest.checksum.slice(0, 14)) + '…</span><span>· ' + escapeHtml(formatDate(latest.publishedAt)) + '</span></div>' : '') +
      '</article>';
  }

  function renderCatalog() {
    const grid = byId("app-grid");
    const sorted = sortApps(state.apps);
    byId("catalog-count").textContent = sorted.length + (sorted.length === 1 ? " ứng dụng" : " ứng dụng") + " trong catalog";
    if (!sorted.length) {
      const hasSearch = Boolean(state.query);
      grid.innerHTML = '<div class="empty-catalog"><span>⌕</span><h3>' + (hasSearch ? "Không tìm thấy ứng dụng" : "Chưa có bản phát hành công khai") + '</h3><p>' + (hasSearch ? "Thử từ khóa khác hoặc chọn Tất cả danh mục." : "Khi developer xuất bản ứng dụng đầu tiên, nội dung sẽ hiển thị tại đây.") + '</p></div>';
      return;
    }
    grid.innerHTML = sorted.map(renderAppCard).join("");
  }

  async function loadStats() {
    try { setStats(await request("/api/stats/public")); }
    catch (error) {
      byId("stat-apps").textContent = "—";
      byId("stat-releases").textContent = "—";
      byId("stat-downloads").textContent = "—";
    }
  }

  async function loadApps() {
    const requestId = ++state.requestId;
    const params = new URLSearchParams();
    if (state.query) params.set("q", state.query);
    if (state.category !== "all") params.set("category", state.category);
    try {
      const result = await request("/api/apps" + (params.toString() ? "?" + params.toString() : ""));
      if (requestId !== state.requestId) return;
      state.apps = Array.isArray(result.apps) ? result.apps : [];
      renderCatalog();
    } catch (error) {
      if (requestId !== state.requestId) return;
      byId("app-grid").innerHTML = '<div class="empty-catalog"><span>⌁</span><h3>Chưa kết nối được API</h3><p>Hãy kiểm tra API_BASE_URL trong public/config.js và trạng thái triển khai backend.</p></div>';
      byId("catalog-count").textContent = "API CONNECTION REQUIRED";
      showToast(error.message, true);
    }
  }

  function setupFilters() {
    const filterContainer = byId("category-filters");
    filterContainer.addEventListener("click", function (event) {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category || "all";
      filterContainer.querySelectorAll(".filter-chip").forEach(function (chip) { chip.classList.toggle("is-active", chip === button); });
      loadApps();
    });
    const search = byId("search-input");
    let searchTimer;
    search.addEventListener("input", function () {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () {
        state.query = search.value.trim();
        loadApps();
      }, 220);
    });
    search.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        state.query = search.value.trim();
        loadApps();
      }
    });
    byId("sort-select").addEventListener("change", function (event) {
      state.sort = event.target.value;
      renderCatalog();
    });
  }

  function setupMobileMenu() {
    const button = byId("mobile-menu");
    const nav = document.querySelector(".topnav");
    button.addEventListener("click", function () {
      const isOpen = nav.classList.toggle("is-open");
      button.setAttribute("aria-expanded", String(isOpen));
    });
    nav.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        nav.classList.remove("is-open");
        button.setAttribute("aria-expanded", "false");
      });
    });
  }

  function init() {
    byId("current-year").textContent = String(new Date().getFullYear());
    setupFilters();
    setupMobileMenu();
    loadStats();
    loadApps();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
