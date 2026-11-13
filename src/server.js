"use strict";

const { loadConfig } = require("./config");
const { createRedisCache } = require("./cache");
const { createApp } = require("./app");

const config = loadConfig();
const log = (message) => console.log(message);

const cache = createRedisCache(config.redisUrl, log);
const app = createApp({ config, cache, log });

const server = app.listen(config.port, () => {
  log(`smart-paywall-proxy listening on port ${config.port}`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, shutting down`);

  // Let in-flight requests finish, but never outlive the pod's grace period.
  setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    cache.close().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
