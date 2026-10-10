import { urlSafetyMessage } from "@/lib/urlSafety";
import { harvestFromHtml, harvestFromUrl, mergeHarvests, rankWeb, type AppLink, type Harvest, type WebCandidate } from "@/services/extraction/resolution/candidates";
import { UNRESOLVED_MESSAGE, type ResolveContext, type ResolveOutcome, type ResolvedUrl } from "@/services/extraction/resolution/types";

export type Accepted = { url: string; productId?: string };

/** What makes a provider's answer acceptable. The tracer owns the loop, the limits and the safety checks. */
export type TracePolicy = {
  provider: "zigzag" | "generic";
  /** A candidate web address that is the product page, cleaned up; undefined when it is not. */
  accept(candidate: WebCandidate): Accepted | undefined;
  /** Only when nothing above matched: an app link that has just a product id. Must follow a rule seen in the link data. */
  fromProductId?(app: AppLink): Accepted | undefined;
};

const appSchemeLocation = /^[a-z][a-z0-9+.-]*:/i;

function blocked(message: string): ResolveOutcome {
  return { ok: false, code: "blocked_url", message };
}

function unresolved(): ResolveOutcome {
  return { ok: false, code: "unresolved_share_link", message: UNRESOLVED_MESSAGE };
}

/**
 * Follows a share link one hop at a time and looks for the real product page after each step: in the address it just
 * moved to, in an app-scheme redirect (read, never fetched), and in the page body. Every address that is fetched or
 * accepted passes the same safety validation as a user-entered URL, and the loop is bounded by a redirect count, a loop
 * check and a time budget.
 */
export async function traceShareLink(input: URL, ctx: ResolveContext, policy: TracePolicy): Promise<ResolveOutcome> {
  const inputUrl = input.toString();
  const seen = new Set<string>();
  let current = inputUrl;
  let redirectCount = 0;

  const success = (accepted: Accepted, resolutionType: ResolvedUrl["resolutionType"], derivedFromId = false): ResolvedUrl => ({
    ok: true,
    inputUrl,
    canonicalUrl: accepted.url,
    provider: policy.provider,
    resolutionType,
    redirectCount,
    extractedProductId: accepted.productId,
    derivedFromId: derivedFromId || undefined,
  });

  const decide = (harvest: Harvest): ResolveOutcome | undefined => {
    const webs = [...harvest.web].sort((a, b) => rankWeb(a) - rankWeb(b));
    for (const candidate of webs) {
      // The destination is only used if it is itself a safe public address.
      if (!ctx.validate(candidate.url).ok) continue;
      const accepted = policy.accept(candidate);
      if (!accepted || !ctx.validate(accepted.url).ok) continue;
      return success(accepted, candidate.via.startsWith("app-") || candidate.via === "intent-fallback" ? "deep-link" : "short-link");
    }
    for (const app of harvest.apps) {
      const accepted = policy.fromProductId?.(app);
      if (accepted && ctx.validate(accepted.url).ok) return success(accepted, "deep-link", true);
    }
    return undefined;
  };

  for (;;) {
    const safety = ctx.validate(current);
    if (!safety.ok) return blocked(urlSafetyMessage(safety.reason));
    if (seen.has(current)) return unresolved(); // redirect loop
    seen.add(current);

    // The destination is often already spelled out in the address we were just sent to (e.g. a tracking redirect).
    const fromAddress = decide(harvestFromUrl(current));
    if (fromAddress) return fromAddress;

    const remaining = ctx.deadline - ctx.now();
    if (remaining <= 0) return unresolved();

    const hop = await ctx.hop(current, remaining);

    if ("ok" in hop) {
      return hop.code === "blocked_url" || hop.code === "invalid_url" ? blocked(hop.message) : unresolved();
    }

    if (hop.kind === "page") {
      return decide(harvestFromHtml(hop.html)) ?? unresolved();
    }

    // Redirect. A custom scheme (zigzag://, intent://) is data to read, never an address to request.
    if (appSchemeLocation.test(hop.location) && !/^https?:/i.test(hop.location)) {
      return decide(mergeHarvests(harvestFromHtml(hop.location), harvestFromUrl(hop.location))) ?? unresolved();
    }

    redirectCount += 1;
    if (redirectCount > ctx.maxRedirects) return unresolved();
    try {
      current = new URL(hop.location, current).toString();
    } catch {
      return unresolved();
    }
  }
}
