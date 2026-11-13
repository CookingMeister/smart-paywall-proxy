"use strict";

const { hostMatches } = require("./url");
const { isBlocked } = require("./detect");

const USER_AGENT = "smart-paywall-proxy/2.0";

// Order in which to try the providers. Add a domain to LADDER_FIRST only when
// ladder measurably beats 13ft for it. medium.com used to be here, but on
// 2026-11-13 ladder got Medium's block page (with or without the community
// ruleset) while 13ft returned the full article.
const LADDER_FIRST = [];

function strategyFor(target) {
  const host = new URL(target).hostname;
  return LADDER_FIRST.some((domain) => hostMatches(host, domain)) ? ["ladder-go", "13ft"] : ["13ft", "ladder-go"];
}

// Cache lifetime in seconds; news front pages change faster than articles.
const TTL_RULES = [
  ["medium.com", 600],
  ["nytimes.com", 300],
  ["theguardian.com", 900],
];
const DEFAULT_TTL = 3600;

function ttlFor(target) {
  const host = new URL(target).hostname;
  const rule = TTL_RULES.find(([domain]) => hostMatches(host, domain));
  return rule ? rule[1] : DEFAULT_TTL;
}

async function readLimited(res, maxBytes) {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) {
    await res.body?.cancel();
    throw new Error(`response too large (${declared} bytes)`);
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of res.body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      throw new Error(`response larger than ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function charsetOf(res) {
  const match = /charset=([^;]+)/i.exec(res.headers.get("content-type") || "");
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : "utf-8";
}

function decode(buffer, charset) {
  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

/**
 * Ask one provider for the target. Returns the page HTML, or null when the
 * provider failed, timed out, returned too much, or returned a block page.
 */
async function fetchVia(name, baseUrl, target, { timeoutMs, maxBytes, fetchImpl = fetch, log = () => {} }) {
  let base = baseUrl;
  while (base.endsWith("/")) base = base.slice(0, -1);
  const url = `${base}/${target}`;

  try {
    const res = await fetchImpl(url, {
      // Covers the body as well as the headers.
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": USER_AGENT },
    });

    if (res.status !== 200) {
      await res.body?.cancel();
      log(`${name}: HTTP ${res.status} for ${target}`);
      return null;
    }

    const html = decode(await readLimited(res, maxBytes), charsetOf(res));

    if (isBlocked(html)) {
      log(`${name}: blocked page (${html.length} chars) for ${target}`);
      return null;
    }

    return html;
  } catch (err) {
    const reason = err.name === "TimeoutError" ? `timed out after ${timeoutMs} ms` : err.cause?.code || err.message;
    log(`${name}: failed for ${target}: ${reason}`);
    return null;
  }
}

module.exports = { DEFAULT_TTL, fetchVia, strategyFor, ttlFor };
