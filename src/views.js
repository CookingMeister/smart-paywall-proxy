"use strict";

const { escapeHtml } = require("./sanitize");

function renderHomePage({ prefill = "", refresh = false, error = "" } = {}) {
  const errorBlock = error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Smart Proxy</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    :root {
      color-scheme: dark;
    }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
    }
    .wrap {
      max-width: 900px;
      margin: 40px auto;
      padding: 24px;
    }
    .card {
      background: #111827;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 10px 30px rgba(0,0,0,.25);
    }
    h1 {
      margin-top: 0;
      font-size: 28px;
    }
    p {
      color: #cbd5e1;
    }
    .error {
      margin: 12px 0;
      padding: 12px 14px;
      border-radius: 10px;
      border: 1px solid #b91c1c;
      background: #450a0a;
      color: #fecaca;
    }
    input[type="url"] {
      width: 100%;
      box-sizing: border-box;
      padding: 14px 16px;
      border-radius: 10px;
      border: 1px solid #475569;
      background: #020617;
      color: #e2e8f0;
      font-size: 16px;
      margin: 12px 0 16px 0;
    }
    .row {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    label {
      font-size: 14px;
      color: #cbd5e1;
    }
    .actions {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    button {
      padding: 12px 18px;
      border: 0;
      border-radius: 10px;
      cursor: pointer;
      font-size: 15px;
      font-weight: 600;
    }
    .primary {
      background: #2563eb;
      color: white;
    }
    .secondary {
      background: #334155;
      color: white;
    }
    .links {
      margin-top: 18px;
      font-size: 14px;
    }
    .links a {
      color: #93c5fd;
      text-decoration: none;
      margin-right: 14px;
    }
    .hint {
      margin-top: 14px;
      font-size: 13px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Smart Proxy</h1>
      <p>Paste an article URL and open it through the proxy, or force Archive.</p>
      ${errorBlock}

      <form id="proxyForm">
        <input
          id="url"
          type="url"
          name="url"
          placeholder="https://example.com/article"
          value="${escapeHtml(prefill)}"
          required
        >

        <div class="row">
          <label>
            <input id="refresh" type="checkbox" name="refresh" value="1" ${refresh ? "checked" : ""}>
            Bypass cache
          </label>
        </div>

        <div class="actions">
          <button class="primary" type="submit">Open Page</button>
          <button class="secondary" type="button" id="archiveBtn">Open Archive</button>
        </div>
      </form>

      <div class="links">
        <a href="/stats">Stats</a>
        <a href="/health">Health</a>
      </div>

      <div class="hint">
        Direct API still works: /?url=https://example.com/article&amp;refresh=1
      </div>
    </div>
  </div>

  <script>
    const form = document.getElementById("proxyForm");
    const urlInput = document.getElementById("url");
    const refreshInput = document.getElementById("refresh");
    const archiveBtn = document.getElementById("archiveBtn");

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      const url = urlInput.value.trim();
      if (!url) return;

      const refresh = refreshInput.checked ? "&refresh=1" : "";
      window.location.href = "/?url=" + encodeURIComponent(url) + refresh;
    });

    archiveBtn.addEventListener("click", function () {
      const url = urlInput.value.trim();
      if (!url) return;

      window.location.href = "/archive?url=" + encodeURIComponent(url);
    });
  </script>
</body>
</html>`;
}

module.exports = { renderHomePage };
