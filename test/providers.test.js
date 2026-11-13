"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_TTL, fetchVia, strategyFor, ttlFor } = require("../src/providers");

const ARTICLE = "<html><head><title>Story</title></head><body>Article text</body></html>";
const options = (fetchImpl, extra = {}) => ({ timeoutMs: 1000, maxBytes: 1024, fetchImpl, ...extra });

test("strategy tries 13ft first, including for medium.com", () => {
  assert.deepEqual(strategyFor("https://medium.com/x"), ["13ft", "ladder-go"]);
  assert.deepEqual(strategyFor("https://example.com/x"), ["13ft", "ladder-go"]);
});

test("ttl follows the site rules", () => {
  assert.equal(ttlFor("https://www.nytimes.com/a"), 300);
  assert.equal(ttlFor("https://medium.com/a"), 600);
  assert.equal(ttlFor("https://www.theguardian.com/a"), 900);
  assert.equal(ttlFor("https://example.com/a"), DEFAULT_TTL);
});

test("requests the target through the provider's base URL", async () => {
  let requested;
  const html = await fetchVia("13ft", "http://ladder13ft:5000/", "https://example.com/a", options(async (url) => {
    requested = url;
    return new Response(ARTICLE, { status: 200 });
  }));
  assert.equal(requested, "http://ladder13ft:5000/https://example.com/a");
  assert.equal(html, ARTICLE);
});

test("non-200, blocked, oversized and failed responses return null", async () => {
  const cases = {
    "HTTP 404": async () => new Response("missing", { status: 404 }),
    blocked: async () => new Response("<title>Just a moment...</title>", { status: 200 }),
    "declared too large": async () =>
      new Response(ARTICLE, { status: 200, headers: { "content-length": "999999" } }),
    "streamed too large": async () => new Response("x".repeat(5000), { status: 200 }),
    "connection refused": async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    },
  };

  for (const [name, fetchImpl] of Object.entries(cases)) {
    const logs = [];
    const result = await fetchVia("13ft", "http://p", "https://example.com/", options(fetchImpl, { log: (m) => logs.push(m) }));
    assert.equal(result, null, name);
    assert.equal(logs.length, 1, `${name} logs once`);
  }
});

test("times out slow providers", async () => {
  const slow = (url, { signal }) =>
    new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason));
    });
  const logs = [];
  const result = await fetchVia("ladder-go", "http://p", "https://example.com/", {
    timeoutMs: 50,
    maxBytes: 1024,
    fetchImpl: slow,
    log: (m) => logs.push(m),
  });
  assert.equal(result, null);
  assert.match(logs[0], /timed out after 50 ms/);
});

test("decodes the charset the provider declares", async () => {
  const latin1 = Buffer.from("<title>Caf\xe9</title>", "latin1");
  const html = await fetchVia("13ft", "http://p", "https://example.com/", options(async () =>
    new Response(latin1, { status: 200, headers: { "content-type": "text/html; charset=ISO-8859-1" } }),
  ));
  assert.equal(html, "<title>Café</title>");
});
