"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { hostMatches, isPrivateAddress, parseTarget, TargetError } = require("../src/url");

const publicLookup = async () => [{ address: "93.184.215.14", family: 4 }];
const lanLookup = async () => [{ address: "192.168.0.217", family: 4 }];
const failingLookup = async () => {
  throw new Error("ENOTFOUND");
};

test("strips tracking parameters and the fragment", async () => {
  const url = await parseTarget(
    "https://example.com/a?utm_source=x&id=7&fbclid=y#section",
    { lookup: publicLookup },
  );
  assert.equal(url, "https://example.com/a?id=7");
});

test("rejects non-string, empty, oversized and malformed input", async () => {
  for (const input of [undefined, ["a", "b"], "", "   ", "not a url", `https://e.com/${"a".repeat(2100)}`]) {
    await assert.rejects(parseTarget(input, { lookup: publicLookup }), TargetError, String(input).slice(0, 30));
  }
});

test("rejects schemes other than http and https", async () => {
  for (const input of ["file:///etc/passwd", "ftp://example.com/", "javascript:alert(1)", "data:text/html,hi"]) {
    await assert.rejects(parseTarget(input, { lookup: publicLookup }), TargetError, input);
  }
});

test("rejects URLs carrying credentials", async () => {
  await assert.rejects(parseTarget("https://user:pass@example.com/", { lookup: publicLookup }), TargetError);
});

test("rejects local names and private literals", async () => {
  for (const input of [
    "http://localhost:3000/",
    "http://nas.local/",
    "http://truenas/",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://192.168.0.144/",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:192.168.0.1]/",
  ]) {
    await assert.rejects(parseTarget(input, { lookup: publicLookup }), TargetError, input);
  }
});

test("rejects public-looking names that resolve to the LAN", async () => {
  await assert.rejects(
    parseTarget("https://anything.home.example.dev/", { lookup: lanLookup }),
    /Private network addresses/,
  );
});

test("rejects names that do not resolve", async () => {
  await assert.rejects(parseTarget("https://nope.invalid-tld-zzz/", { lookup: failingLookup }), /Could not resolve/);
});

test("allowPrivate skips the address checks but still validates the URL", async () => {
  assert.equal(await parseTarget("http://192.168.0.144/", { allowPrivate: true }), "http://192.168.0.144/");
  await assert.rejects(parseTarget("file:///etc/passwd", { allowPrivate: true }), TargetError);
});

test("isPrivateAddress", () => {
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("2606:4700::1111"), false);
  assert.equal(isPrivateAddress("172.20.1.1"), true);
  assert.equal(isPrivateAddress("100.64.0.1"), true);
  assert.equal(isPrivateAddress("fe80::1"), true);
  assert.equal(isPrivateAddress("not-an-ip"), false);
});

test("hostMatches only matches the domain and its subdomains", () => {
  assert.equal(hostMatches("medium.com", "medium.com"), true);
  assert.equal(hostMatches("blog.medium.com", "medium.com"), true);
  assert.equal(hostMatches("notmedium.com", "medium.com"), false);
  assert.equal(hostMatches("medium.com.evil.example", "medium.com"), false);
});
