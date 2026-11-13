"use strict";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Best-effort removal of scripts and redirects. Regex cleaning of HTML is not
 * a security boundary on its own; the Content-Security-Policy sent with every
 * proxied page (script-src 'none') is what actually stops scripts running.
 */
function sanitizeHtml(html) {
  return String(html)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/\son\w+=([^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");
}

/** Make the article's relative links and images resolve against its own site. */
function injectBaseTag(html, targetUrl) {
  const baseTag = `<base href="${escapeHtml(targetUrl)}">`;

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`);
  }

  return `${baseTag}${html}`;
}

module.exports = { escapeHtml, injectBaseTag, sanitizeHtml };
