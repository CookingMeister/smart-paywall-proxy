"use strict";

const express = require("express");
const { parseTarget, TargetError } = require("./url");
const { injectBaseTag, sanitizeHtml } = require("./sanitize");
const { fetchVia, strategyFor, ttlFor } = require("./providers");
const { renderHomePage } = require("./views");

// Sent with every proxied page. script-src 'none' is the real protection
// against scripts in the fetched HTML; sanitizeHtml is only a first pass.
const PROXY_CSP = [
  "default-src * data: blob:;",
  "img-src * data: blob:;",
  "style-src * 'unsafe-inline';",
  "font-src * data:;",
  "media-src * data: blob:;",
  "connect-src *;",
  "frame-src *;",
  "object-src 'none';",
  "script-src 'none';",
].join(" ");

const STATS_KEYS = ["stats:hits", "stats:misses", "stats:fallback_archive"];

function archiveUrl(target) {
  return `https://archive.today/?run=1&url=${encodeURIComponent(target)}`;
}

function wantsRefresh(value) {
  return value !== undefined && value !== "0" && value !== "false";
}

function createApp({ config, cache, fetchImpl = fetch, lookup, log = () => {} }) {
  const app = express();
  app.disable("x-powered-by");

  async function proxy(target, refresh) {
    if (refresh) {
      await cache.del(target);
    } else {
      const cached = await cache.get(target);
      if (cached) {
        await cache.incr("stats:hits");
        log(`cache hit: ${target}`);
        return { html: cached };
      }
    }

    await cache.incr("stats:misses");

    for (const name of strategyFor(target)) {
      const html = await fetchVia(name, config.providers[name], target, {
        timeoutMs: config.timeoutMs,
        maxBytes: config.maxBytes,
        fetchImpl,
        log,
      });

      if (html) {
        const page = sanitizeHtml(injectBaseTag(html, target));
        await cache.set(target, page, ttlFor(target));
        log(`${name}: ok for ${target}`);
        return { html: page };
      }
    }

    await cache.incr("stats:fallback_archive");
    log(`archive fallback: ${target}`);
    return { redirect: archiveUrl(target) };
  }

  app.get("/health", (req, res) => {
    // The cache is optional, so a Redis outage is reported but not fatal.
    res.json({ status: "ok", cache: cache.isReady ? "up" : "down" });
  });

  app.get("/stats", async (req, res) => {
    const values = await cache.getMany(STATS_KEYS);
    if (!values) return res.status(503).json({ error: "cache unavailable" });

    const [hits, misses, fallback] = values.map((value) => Number(value) || 0);
    const total = hits + misses;

    res.json({
      hits,
      misses,
      fallback_archive: fallback,
      hit_rate: total > 0 ? hits / total : 0,
    });
  });

  app.get("/archive", async (req, res, next) => {
    if (req.query.url === undefined) return res.type("html").send(renderHomePage());
    try {
      // archive.today fetches the page, not us, so private targets are not a risk here.
      const target = await parseTarget(req.query.url, { allowPrivate: true });
      res.redirect(archiveUrl(target));
    } catch (err) {
      next(err);
    }
  });

  app.get("/", async (req, res, next) => {
    const refresh = wantsRefresh(req.query.refresh);
    if (req.query.url === undefined) return res.type("html").send(renderHomePage({ refresh }));

    try {
      const target = await parseTarget(req.query.url, {
        allowPrivate: config.allowPrivateTargets,
        lookup,
      });
      const result = await proxy(target, refresh);

      if (result.redirect) return res.redirect(result.redirect);

      res
        .set("Content-Security-Policy", PROXY_CSP)
        // Keep the proxy's own URL out of requests the page makes to its site.
        .set("Referrer-Policy", "no-referrer")
        .type("html")
        .send(result.html);
    } catch (err) {
      next(err);
    }
  });

  // eslint-disable-next-line no-unused-vars -- Express needs all four arguments.
  app.use((err, req, res, next) => {
    const prefill = typeof req.query.url === "string" ? req.query.url : "";

    if (err instanceof TargetError) {
      return res.status(400).type("html").send(renderHomePage({ prefill, error: err.message }));
    }

    log(`error: ${err.stack || err}`);
    res.status(500).type("html").send(renderHomePage({ prefill, error: "Internal proxy error" }));
  });

  return app;
}

module.exports = { archiveUrl, createApp, PROXY_CSP };
