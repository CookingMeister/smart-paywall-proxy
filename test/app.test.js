"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createApp, PROXY_CSP } = require("../src/app");
const { createMemoryCache } = require("../src/cache");
const { loadConfig } = require("../src/config");

const ARTICLE = '<html><head><title>Story</title></head><body onload="x()">Text<script>evil()</script></body></html>';

// Starts the app on a random port with fake providers. `respond` maps a
// provider name to a function returning a Response (or throwing).
async function startApp(respond, { cache = createMemoryCache(), lookup } = {}) {
  const config = loadConfig({});
  const calls = [];
  const fetchImpl = async (url) => {
    const name = url.startsWith(config.providers["13ft"]) ? "13ft" : "ladder-go";
    calls.push(name);
    return respond[name]();
  };

  const app = createApp({
    config,
    cache,
    fetchImpl,
    lookup: lookup || (async () => [{ address: "93.184.215.14", family: 4 }]),
  });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  return {
    calls,
    cache,
    get: (path) => fetch(base + path, { redirect: "manual" }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

const ok = () => new Response(ARTICLE, { status: 200 });
const down = () => {
  throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
};

test("serves the home page", async (t) => {
  const app = await startApp({});
  t.after(app.close);
  const res = await app.get("/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Smart Proxy/);
});

test("proxies through the first provider, sanitises, and caches", async (t) => {
  const app = await startApp({ "13ft": ok, "ladder-go": ok });
  t.after(app.close);

  const first = await app.get("/?url=" + encodeURIComponent("https://example.com/a?utm_source=x"));
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-security-policy"), PROXY_CSP);
  assert.equal(first.headers.get("referrer-policy"), "no-referrer");
  const html = await first.text();
  assert.match(html, /<base href="https:\/\/example.com\/a">/);
  assert.doesNotMatch(html, /evil\(\)|onload=/);
  assert.deepEqual(app.calls, ["13ft"]);

  await app.get("/?url=" + encodeURIComponent("https://example.com/a"));
  assert.deepEqual(app.calls, ["13ft"], "second request is served from cache");

  const stats = await (await app.get("/stats")).json();
  assert.deepEqual(stats, { hits: 1, misses: 1, fallback_archive: 0, hit_rate: 0.5 });
});

test("refresh bypasses the cache", async (t) => {
  const app = await startApp({ "13ft": ok, "ladder-go": ok });
  t.after(app.close);
  await app.get("/?url=https://example.com/a");
  await app.get("/?url=https://example.com/a&refresh=1");
  assert.deepEqual(app.calls, ["13ft", "13ft"]);
});

test("falls through to the second provider, then to archive.today", async (t) => {
  const app = await startApp({ "13ft": down, "ladder-go": ok });
  t.after(app.close);
  const second = await app.get("/?url=https://example.com/b");
  assert.equal(second.status, 200);
  assert.deepEqual(app.calls, ["13ft", "ladder-go"]);

  const none = await startApp({ "13ft": down, "ladder-go": down });
  t.after(none.close);
  const res = await none.get("/?url=https://example.com/c");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://archive.today/?run=1&url=https%3A%2F%2Fexample.com%2Fc");
});

test("bad and private URLs get a 400 page, not a fetch", async (t) => {
  const app = await startApp({ "13ft": ok, "ladder-go": ok });
  t.after(app.close);
  for (const path of ["/?url=file:///etc/passwd", "/?url=http://192.168.0.144/", "/?url=a&url=b"]) {
    const res = await app.get(path);
    assert.equal(res.status, 400, path);
    assert.match(await res.text(), /role="alert"/);
  }
  assert.deepEqual(app.calls, []);
});

test("the archive button redirects without fetching", async (t) => {
  const app = await startApp({});
  t.after(app.close);
  const res = await app.get("/archive?url=https://example.com/d");
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "https://archive.today/?run=1&url=https%3A%2F%2Fexample.com%2Fd");
});

test("keeps proxying when the cache is down", async (t) => {
  const dead = {
    isReady: false,
    get: async () => null,
    set: async () => null,
    del: async () => null,
    incr: async () => null,
    getMany: async () => null,
    close: async () => {},
  };
  const app = await startApp({ "13ft": ok, "ladder-go": ok }, { cache: dead });
  t.after(app.close);

  assert.equal((await app.get("/?url=https://example.com/e")).status, 200);
  assert.deepEqual(await (await app.get("/health")).json(), { status: "ok", cache: "down" });
  assert.equal((await app.get("/stats")).status, 503);
});
