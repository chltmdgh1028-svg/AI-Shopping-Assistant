// Finds the places a share link can hide its destination: query parameters (often percent-encoded, sometimes
// twice), app-scheme deep links, intent:// links, meta refresh and script redirects. Nothing here fetches anything.

export type WebCandidate = { url: string; via: string };
export type AppLink = { scheme: string; productId?: string; web: WebCandidate[] };
export type Harvest = { web: WebCandidate[]; apps: AppLink[] };

// Schemes that can run code or read local data. They are never a destination, whatever a page says.
const dangerousSchemes = new Set(["javascript", "data", "file", "ftp", "vbscript", "blob", "about", "chrome", "view-source"]);
const schemeStart = /^([a-z][a-z0-9+.-]*):/i;
const idParams = ["catalog_product_id", "product_id", "item_id", "goods_no", "productid"];
const webParams = ["url", "fallback_url", "fallback", "web_url", "link", "target_url", "target", "browser_fallback_url"];

export const emptyHarvest = (): Harvest => ({ web: [], apps: [] });

const isHttp = (value: string) => /^https?:\/\//i.test(value);

/** "%3A%2F%2F" in a value means it was encoded one level deeper than the query string already decoded. */
function decodeNested(value: string) {
  let current = value;
  for (let i = 0; i < 2 && /%3A%2F%2F|%2F%2F/i.test(current); i += 1) {
    try {
      current = decodeURIComponent(current);
    } catch {
      break;
    }
  }
  return current;
}

function unescapeMarkup(value: string) {
  return value
    .replace(/[\\]u0026|&amp;/gi, "&")
    .replace(/[\\]u002f/gi, "/")
    .replace(/[\\]\//g, "/")
    .replace(/&#x2F;/gi, "/");
}

/** Reads a custom-scheme link. Returns undefined for http(s) and for schemes that must be ignored. */
export function parseAppLink(raw: string): AppLink | undefined {
  const value = unescapeMarkup(decodeNested(raw.trim()));
  const scheme = value.match(schemeStart)?.[1]?.toLowerCase();
  if (!scheme || scheme === "http" || scheme === "https" || dangerousSchemes.has(scheme)) return undefined;

  const web: WebCandidate[] = [];
  let query = "";
  let productId: string | undefined;

  if (scheme === "intent") {
    // intent://open/product?catalog_product_id=1#Intent;scheme=zigzag;S.browser_fallback_url=https%3A%2F%2F...;end
    const [head, extras = ""] = value.split("#Intent;");
    query = head.includes("?") ? head.slice(head.indexOf("?") + 1) : "";
    for (const part of extras.split(";")) {
      const match = part.match(/^S\.browser_fallback_url=(.+)$/);
      if (!match) continue;
      const decoded = decodeNested(match[1]);
      if (isHttp(decoded)) web.push({ url: decoded, via: "intent-fallback" });
    }
  } else {
    query = value.includes("?") ? value.slice(value.indexOf("?") + 1).split("#")[0] : "";
  }

  const params = new URLSearchParams(query);
  for (const key of idParams) {
    const candidate = params.get(key);
    if (candidate && /^[A-Za-z0-9_-]{1,40}$/.test(candidate)) {
      productId = candidate;
      break;
    }
  }
  for (const key of webParams) {
    const candidate = params.get(key);
    if (candidate && isHttp(decodeNested(candidate))) web.push({ url: decodeNested(candidate), via: `app-${key}` });
  }

  return { scheme, productId, web };
}

function addValue(harvest: Harvest, key: string, value: string) {
  const decoded = decodeNested(value);
  if (isHttp(decoded)) harvest.web.push({ url: decoded, via: key });
  else {
    const app = parseAppLink(decoded);
    if (app) {
      harvest.apps.push(app);
      harvest.web.push(...app.web);
    }
  }
}

/** The address itself, plus every value in its query string that is a URL or an app link. */
export function harvestFromUrl(raw: string): Harvest {
  const harvest = emptyHarvest();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return harvest;
  }
  if (url.protocol === "http:" || url.protocol === "https:") harvest.web.push({ url: url.toString(), via: "self" });
  for (const [key, value] of url.searchParams) addValue(harvest, key.toLowerCase(), value);
  return harvest;
}

/** Redirects written into the page: meta refresh, location assignments, app links and fallback fields in script data. */
export function harvestFromHtml(html: string): Harvest {
  const harvest = emptyHarvest();
  const text = unescapeMarkup(html);

  for (const tag of text.matchAll(/<meta\s[^>]*>/gi)) {
    if (!/http-equiv\s*=\s*["']?refresh/i.test(tag[0])) continue;
    const target = tag[0].match(/content\s*=\s*["'][^"']*?url\s*=\s*['"]?([^"';]+)/i)?.[1];
    if (target) addValue(harvest, "meta-refresh", target.trim());
  }

  for (const match of text.matchAll(/location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.(?:replace|assign)\(\s*["']([^"']+)["']\s*\)/gi)) {
    addValue(harvest, "script", match[1] ?? match[2]);
  }

  for (const match of text.matchAll(/\b(?:zigzag|intent):\/\/[^\s"'<>\\)]+/gi)) addValue(harvest, "page-app-link", match[0]);

  for (const match of text.matchAll(/"(?:fallback\w*|desktop\w*url)"\s*:\s*"(https?:[^"]+)"/gi)) addValue(harvest, "fallback", match[1]);

  return harvest;
}

export function mergeHarvests(...items: Harvest[]): Harvest {
  return { web: items.flatMap((item) => item.web), apps: items.flatMap((item) => item.apps) };
}

/** Fallback-named fields first, then URLs carried by an app link, then anything else. */
export function rankWeb(candidate: WebCandidate) {
  if (/fallback/i.test(candidate.via)) return 0;
  if (candidate.via.startsWith("app-") || candidate.via === "intent-fallback") return 1;
  return candidate.via === "self" ? 3 : 2;
}
