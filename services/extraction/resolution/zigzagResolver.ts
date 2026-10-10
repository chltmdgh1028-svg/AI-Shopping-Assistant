import type { AppLink, WebCandidate } from "@/services/extraction/resolution/candidates";
import { traceShareLink, type Accepted, type TracePolicy } from "@/services/extraction/resolution/trace";
import type { ResolveContext, ResolveOutcome, ShortUrlResolver } from "@/services/extraction/resolution/types";

const zigzagHosts = new Set(["zigzag.kr", "www.zigzag.kr", "store.zigzag.kr"]);

// Product page shapes seen in real Zigzag share links and page data: zigzag.kr/p/<id> is what the link's own
// fallback_desktop points to; the store paths are what the app link's url parameter points to.
const productPaths = [/^\/p\/(\d+)\/?$/, /^\/app\/catalog\/products\/(\d+)\/?$/, /^\/catalog\/products\/(\d+)\/?$/];

function acceptZigzag(candidate: WebCandidate): Accepted | undefined {
  let url: URL;
  try {
    url = new URL(candidate.url);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  if (!zigzagHosts.has(url.hostname.toLowerCase())) return undefined;

  for (const pattern of productPaths) {
    const id = url.pathname.match(pattern)?.[1];
    // Tracking parameters (user ids, campaign tags) are dropped: the path alone identifies the product.
    if (id) return { url: `https://${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, "")}`, productId: id };
  }
  return undefined;
}

// Last resort when a link carries only a product id: the same link's fallback_desktop is zigzag.kr/p/<id>, so that is
// the one shape used. It is only reached when no web address was present in the link at all.
function fromId(app: AppLink): Accepted | undefined {
  if (app.scheme !== "zigzag" && app.scheme !== "intent") return undefined;
  return app.productId && /^\d{1,20}$/.test(app.productId) ? { url: `https://zigzag.kr/p/${app.productId}`, productId: app.productId } : undefined;
}

const policy: TracePolicy = { provider: "zigzag", accept: acceptZigzag, fromProductId: fromId };

/** s.zigzag.kr/<token>: the share link the Zigzag app copies. It redirects through a tracking service to an app link. */
export class ZigzagResolver implements ShortUrlResolver {
  readonly provider = "zigzag" as const;

  matches(url: URL) {
    return url.hostname.toLowerCase() === "s.zigzag.kr";
  }

  resolve(url: URL, ctx: ResolveContext): Promise<ResolveOutcome> {
    return traceShareLink(url, ctx, policy);
  }
}
