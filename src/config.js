"use strict";

function positiveInt(env, name, fallback) {
  const value = Number(env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function loadConfig(env = process.env) {
  return {
    port: positiveInt(env, "PORT", 3000),
    // Per-provider budget, covering both the response headers and the body.
    timeoutMs: positiveInt(env, "TIMEOUT", 5000),
    // Pages larger than this are treated as a provider failure rather than
    // buffered whole into memory.
    maxBytes: positiveInt(env, "MAX_BYTES", 5 * 1024 * 1024),
    redisUrl: env.REDIS_URL || "redis://redis:6379",
    providers: {
      // The 13ft image's gunicorn listens on 5000, not 8080.
      "13ft": env.LADDER13FT_URL || "http://ladder13ft:5000",
      "ladder-go": env.LADDER_GO_URL || "http://ladder-go:8080",
    },
    // Off by default: without it, targets that resolve to loopback, LAN or
    // other private ranges are refused (see src/url.js).
    allowPrivateTargets: env.ALLOW_PRIVATE_TARGETS === "true",
  };
}

module.exports = { loadConfig };
