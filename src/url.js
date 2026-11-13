"use strict";

const net = require("node:net");
const dns = require("node:dns").promises;

const MAX_URL_LENGTH = 2048;

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
];

// Addresses a public article can never legitimately live on. IPv4 rules also
// match IPv4-mapped IPv6 addresses (::ffff:a.b.c.d).
const PRIVATE_RANGES = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 3],
]) {
  PRIVATE_RANGES.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 127],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
]) {
  PRIVATE_RANGES.addSubnet(address, prefix, "ipv6");
}

/** A user-facing problem with the requested URL; rendered as a 400. */
class TargetError extends Error {}

function isPrivateAddress(address) {
  const family = net.isIP(address);
  if (family === 0) return false;
  return PRIVATE_RANGES.check(address, family === 6 ? "ipv6" : "ipv4");
}

function isLocalHostname(host) {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    // Single-label names only resolve through a local search domain.
    (!host.includes(".") && net.isIP(host) === 0)
  );
}

async function assertPublicHost(hostname, lookup) {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (isLocalHostname(host)) {
    throw new TargetError("Local addresses are not allowed");
  }

  let addresses;
  if (net.isIP(host) !== 0) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      throw new TargetError(`Could not resolve ${host}`);
    }
  }

  if (addresses.some(isPrivateAddress)) {
    throw new TargetError("Private network addresses are not allowed");
  }
}

/**
 * Validate and normalise a requested article URL.
 *
 * This is defence in depth only: the providers resolve the name again
 * themselves, so a network policy on the provider pods is what actually
 * keeps them off the LAN.
 */
async function parseTarget(input, { allowPrivate = false, lookup = dns.lookup } = {}) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new TargetError("Enter a single http or https URL");
  }
  if (input.length > MAX_URL_LENGTH) {
    throw new TargetError("That URL is too long");
  }

  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw new TargetError("That is not a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TargetError("Only http and https URLs are supported");
  }
  if (url.username || url.password) {
    throw new TargetError("URLs containing credentials are not supported");
  }

  for (const param of TRACKING_PARAMS) url.searchParams.delete(param);
  // Never sent to a server, so it would only split the cache.
  url.hash = "";

  if (!allowPrivate) await assertPublicHost(url.hostname, lookup);

  return url.toString();
}

/** True for the domain itself or any subdomain of it. */
function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

module.exports = {
  MAX_URL_LENGTH,
  TargetError,
  hostMatches,
  isPrivateAddress,
  parseTarget,
};
