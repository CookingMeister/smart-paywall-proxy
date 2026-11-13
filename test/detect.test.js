"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isBlocked, CHALLENGE_PAGE_CHARS, SHORT_PAGE_CHARS } = require("../src/detect");

const longArticle = (extra) =>
  `<html><head><title>A long read</title></head><body>${"word ".repeat(SHORT_PAGE_CHARS / 4)}${extra}</body></html>`;

test("empty responses count as blocked", () => {
  assert.equal(isBlocked(""), true);
  assert.equal(isBlocked("   \n"), true);
  assert.equal(isBlocked(undefined), true);
});

test("Cloudflare challenge markers are blocked on challenge-sized pages", () => {
  const challenge = (marker) => `<html><head><title>One more step</title></head><body>${"x".repeat(30000)}${marker}</body></html>`;
  assert.equal(isBlocked(challenge('<script src="/cdn-cgi/challenge-platform/h/b"></script>')), true);
  assert.equal(isBlocked(challenge('<div class="cf-chl-widget"></div>')), true);
});

test("Cloudflare bot-management scripts on real article pages are not blocks", () => {
  // wired.com embeds this on every normal article (found 2026-11-13).
  const article = `<html><head><title>Story</title></head><body>${"word ".repeat(CHALLENGE_PAGE_CHARS / 4)}<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>`;
  assert.equal(isBlocked(article), false);
});

test("block phrases in the title are blocked", () => {
  assert.equal(isBlocked("<html><head><title>Just a moment...</title></head><body>…</body></html>"), true);
  assert.equal(isBlocked(longArticle("").replace("A long read", "Access Denied")), true);
});

test("short block pages are blocked", () => {
  assert.equal(isBlocked("<html><body>Please verify you are human</body></html>"), true);
});

test("long articles that merely mention the words are not blocked", () => {
  assert.equal(isBlocked(longArticle("The study found captcha farms; access denied to researchers.")), false);
  assert.equal(isBlocked(longArticle('<script src="https://www.google.com/recaptcha/api.js"></script>')), false);
});

test("normal pages are not blocked", () => {
  assert.equal(isBlocked("<html><head><title>Example Domain</title></head><body>Hello</body></html>"), false);
});
