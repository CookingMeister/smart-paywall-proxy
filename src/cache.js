"use strict";

const { createClient } = require("redis");

/**
 * Redis-backed cache that never throws and never blocks a request. When Redis
 * is down every operation returns its fallback straight away, so pages are
 * still proxied, just uncached.
 */
function createRedisCache(url, log = () => {}) {
  const client = createClient({
    url,
    // node-redis otherwise queues commands while disconnected, which would
    // leave requests hanging until Redis came back.
    disableOfflineQueue: true,
    socket: { reconnectStrategy: (retries) => Math.min(retries * 500, 5000) },
  });

  let lastError = "";
  client.on("error", (err) => {
    // Reconnect attempts repeat the same error; log it once per outage.
    if (err.message !== lastError) {
      lastError = err.message;
      log(`cache: ${err.message}`);
    }
  });
  client.on("ready", () => {
    lastError = "";
    log("cache: connected");
  });

  client.connect().catch((err) => log(`cache: connect failed: ${err.message}`));

  const safe = (operation, fallback) => async (...args) => {
    if (!client.isReady) return fallback;
    try {
      return await operation(...args);
    } catch (err) {
      log(`cache: ${err.message}`);
      return fallback;
    }
  };

  return {
    get isReady() {
      return client.isReady;
    },
    get: safe((key) => client.get(key), null),
    set: safe((key, value, ttlSeconds) => client.set(key, value, { EX: ttlSeconds }), null),
    del: safe((key) => client.del(key), null),
    incr: safe((key) => client.incr(key), null),
    getMany: safe((keys) => client.mGet(keys), null),
    async close() {
      if (client.isOpen) await client.quit().catch(() => {});
    },
  };
}

/** In-process cache with the same interface; used by the tests. */
function createMemoryCache() {
  const entries = new Map();

  const read = (key) => {
    const entry = entries.get(key);
    if (!entry) return null;
    if (entry.expires && entry.expires < Date.now()) {
      entries.delete(key);
      return null;
    }
    return entry.value;
  };

  return {
    isReady: true,
    async get(key) {
      return read(key);
    },
    async set(key, value, ttlSeconds) {
      entries.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    },
    async del(key) {
      entries.delete(key);
    },
    async incr(key) {
      const next = Number(read(key) || 0) + 1;
      entries.set(key, { value: String(next) });
      return next;
    },
    async getMany(keys) {
      return keys.map(read);
    },
    async close() {},
  };
}

module.exports = { createMemoryCache, createRedisCache };
