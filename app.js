const express = require("express");
const fetch = require("node-fetch");
const { createClient } = require("redis");
const { URL } = require("url");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const TIMEOUT = Number(process.env.TIMEOUT || 5000);

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const LADDER_13FT_URL = process.env.LADDER13FT_URL || "http://ladder13ft:8080";
const LADDER_GO_URL = process.env.LADDER_GO_URL || "http://ladder-go:8080";

const PROXY_CSP = [
  "default-src * data: blob:;",
  "img-src * data: blob:;",
  "style-src * 'unsafe-inline';",
  "font-src * data:;",
  "media-src * data: blob:;",
  "connect-src *;",
  "frame-src *;",
  "object-src 'none';",
  "script-src 'none';"
].join(" ");

app.use(express.urlencoded({ extended: false }));

// =====================
// Redis Setup
// =====================
const redis = createClient({
  url: REDIS_URL,
});

redis.on("error", (err) => console.log("Redis error:", err));

(async () => {
  await redis.connect();
  console.log("Connected to Redis");
})();

// =====================
// Helpers
// =====================
function normalizeUrl(input) {
  try {
    const url = new URL(input);

    const blacklist = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid"
    ];

    blacklist.forEach((param) => url.searchParams.delete(param));

    return url.toString();
  } catch {
    return input;
  }
}

function isBlocked(content) {
  if (!content) return true;

  const body = content.toLowerCase();

  const strongSignals = [
    "access denied",
    "cf-browser-verification",
    "captcha",
    "please verify you are human",
    "enable javascript and cookies to continue",
    "just a moment...",
    "attention required!",
    "/cdn-cgi/challenge-platform",
    "cf-chl-"
  ];

  return strongSignals.some((sig) => body.includes(sig));
}

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function sanitizeHtml(html) {
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\son\w+=([^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

function injectBaseTag(html, targetUrl) {
  const baseTag = `<base href="${escapeHtml(targetUrl)}">`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }

  return `${baseTag}${html}`;
}

function buildArchiveUrl(target) {
  return `https://archive.today/?run=1&url=${encodeURIComponent(target)}`;
}

async function tryFetch(url, name, originalTarget) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT);

  try {
    console.log(`Trying ${name}: ${url}`);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "smart-proxy/1.0"
      }
    });

    const text = await res.text();

    console.log(`${name} status: ${res.status}, length: ${text.length}`);

    if (res.status === 200 && !isBlocked(text)) {
      console.log(`SUCCESS: ${name}`);
      return sanitizeHtml(injectBaseTag(text, originalTarget));
    }

    console.log(`BLOCKED: ${name}`);
    console.log(text.slice(0, 300));
  } catch (e) {
    console.log(`FAIL: ${name}`, e.message);
  } finally {
    clearTimeout(timeout);
  }

  return null;
}

function getStrategy(url) {
  const hostname = new URL(url).hostname;

  if (hostname.includes("medium.com")) {
    return ["ladder-go", "13ft"];
  }

  return ["13ft", "ladder-go"];
}

function getTTL(url) {
  const hostname = new URL(url).hostname;

  if (hostname.includes("medium.com")) return 600;
  if (hostname.includes("nytimes.com")) return 300;
  if (hostname.includes("theguardian.com")) return 900;

  return 3600;
}

async function proxyTarget(target, refresh = false) {
  target = normalizeUrl(target);

  console.log("\n=========================");
  console.log("Request:", target);

  if (refresh) {
    console.log("Cache bypass requested");
    await redis.del(target);
  }

  const cached = await redis.get(target);
  if (cached) {
    console.log("CACHE HIT");
    await redis.incr("stats:hits");
    return {
      type: "html",
      content: cached,
      target
    };
  }

  console.log("CACHE MISS");
  await redis.incr("stats:misses");

  const strategy = getStrategy(target);

  for (const method of strategy) {
    let result = null;

    if (method === "13ft") {
      result = await tryFetch(`${LADDER_13FT_URL}/${target}`, "13ft", target);
    }

    if (method === "ladder-go") {
      result = await tryFetch(`${LADDER_GO_URL}/${target}`, "ladder-go", target);
    }

    if (result) {
      const ttl = getTTL(target);
      await redis.setEx(target, ttl, result);
      return {
        type: "html",
        content: result,
        target
      };
    }
  }

  console.log("FALLBACK: archive");
  await redis.incr("stats:fallback_archive");

  return {
    type: "redirect",
    location: buildArchiveUrl(target),
    target
  };
}

function renderHomePage(prefill = "", refresh = false) {
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
        Direct API still works: /?url=https://example.com/article&refresh=1
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

// =====================
// Routes
// =====================
app.get("/health", async (req, res) => {
  try {
    await redis.ping();
    res.json({ status: "ok" });
  } catch {
    res.status(500).json({ status: "error" });
  }
});

app.get("/stats", async (req, res) => {
  const hits = Number(await redis.get("stats:hits")) || 0;
  const misses = Number(await redis.get("stats:misses")) || 0;
  const fallback = Number(await redis.get("stats:fallback_archive")) || 0;

  const total = hits + misses;
  const hitRate = total > 0 ? hits / total : 0;

  res.json({
    hits,
    misses,
    fallback_archive: fallback,
    hit_rate: hitRate
  });
});

app.get("/archive", (req, res) => {
  const target = req.query.url;
  if (!target) {
    return res.type("html").send(renderHomePage());
  }

  return res.redirect(buildArchiveUrl(normalizeUrl(target)));
});

app.get("/", async (req, res) => {
  const target = req.query.url;

  if (!target) {
    return res.type("html").send(renderHomePage("", !!req.query.refresh));
  }

  const refresh = !!req.query.refresh;

  try {
    const result = await proxyTarget(target, refresh);

    if (result.type === "html") {
      res.set("Content-Security-Policy", PROXY_CSP);
      return res.type("html").send(result.content);
    }

    return res.redirect(result.location);
  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).send("Internal proxy error");
  }
});

// =====================
// Start Server
// =====================
app.listen(PORT, () => {
  console.log(`Smart proxy running on port ${PORT}`);
});
