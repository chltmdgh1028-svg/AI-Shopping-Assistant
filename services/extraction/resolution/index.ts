import { urlSafetyMessage, validateHttpUrl } from "@/lib/urlSafety";
import { GenericRedirectResolver } from "@/services/extraction/resolution/genericRedirectResolver";
import type { ResolveContext, ResolveOutcome, ShortUrlResolver } from "@/services/extraction/resolution/types";
import { ZigzagResolver } from "@/services/extraction/resolution/zigzagResolver";
import { fetchHop } from "@/services/extraction/safeFetch";

export * from "@/services/extraction/resolution/types";

// Resolving must leave room for the page fetch (8s) and the model (28s) inside the route's 60s.
export const RESOLVE_BUDGET_MS = 6000;
export const RESOLVE_MAX_REDIRECTS = 5;

// Provider-specific resolvers come before the generic one. Add Musinsa, 29CM, Ably or Kakao links here.
const defaultResolvers: ShortUrlResolver[] = [new ZigzagResolver(), new GenericRedirectResolver()];

export type ResolveOptions = { resolvers?: ShortUrlResolver[]; context?: Partial<ResolveContext> };

/**
 * The step between "what the user pasted" and "fetch the product page". An ordinary product URL is returned as it
 * is, without any request; a share, short or deep link is traced to the real http(s) page.
 */
export async function resolveProductUrl(rawUrl: string, options: ResolveOptions = {}): Promise<ResolveOutcome> {
  const validate = options.context?.validate ?? validateHttpUrl;
  const safety = validate(rawUrl);
  if (!safety.ok) {
    const invalid = safety.reason === "invalid_url" || safety.reason === "url_too_long";
    return { ok: false, code: invalid ? "invalid_url" : "blocked_url", message: urlSafetyMessage(safety.reason) };
  }

  const resolver = (options.resolvers ?? defaultResolvers).find((item) => item.matches(safety.url));
  if (!resolver) {
    return { ok: true, inputUrl: rawUrl.trim(), canonicalUrl: rawUrl.trim(), provider: "none", resolutionType: "none", redirectCount: 0 };
  }

  const now = options.context?.now ?? Date.now;
  const context: ResolveContext = {
    hop: options.context?.hop ?? ((url, timeoutMs) => fetchHop(url, timeoutMs)),
    validate,
    now,
    deadline: options.context?.deadline ?? now() + RESOLVE_BUDGET_MS,
    maxRedirects: options.context?.maxRedirects ?? RESOLVE_MAX_REDIRECTS,
  };
  return resolver.resolve(safety.url, context);
}
