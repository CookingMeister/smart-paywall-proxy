"use strict";

// Cloudflare markers. Not proof on their own: sites with Cloudflare bot
// management (wired.com, for one) embed /cdn-cgi/challenge-platform in every
// normal article. A real interstitial is small, so they only count there.
const CHALLENGE_MARKERS = [
  "cf-browser-verification",
  "/cdn-cgi/challenge-platform",
  "cf-chl-",
  "cf_chl_",
];

// Ordinary words that real articles also use ("captcha", "access denied").
// They only count in the <title>, or on a page too short to be an article.
const BLOCK_PHRASES = [
  "access denied",
  "just a moment...",
  "attention required!",
  "please verify you are human",
  "enable javascript and cookies to continue",
  "captcha",
];

const SHORT_PAGE_CHARS = 20000;
// Cloudflare's challenge page is larger than a plain block page but still far
// smaller than any real article page.
const CHALLENGE_PAGE_CHARS = 60000;

function titleOf(lowerHtml) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/.exec(lowerHtml);
  return match ? match[1] : "";
}

/** Whether a provider returned a block or challenge page instead of the article. */
function isBlocked(html) {
  if (!html || html.trim() === "") return true;

  const body = html.toLowerCase();

  if (body.length < CHALLENGE_PAGE_CHARS && CHALLENGE_MARKERS.some((marker) => body.includes(marker))) {
    return true;
  }

  const title = titleOf(body);
  if (BLOCK_PHRASES.some((phrase) => title.includes(phrase))) return true;

  return body.length < SHORT_PAGE_CHARS && BLOCK_PHRASES.some((phrase) => body.includes(phrase));
}

module.exports = { isBlocked, CHALLENGE_PAGE_CHARS, SHORT_PAGE_CHARS };
