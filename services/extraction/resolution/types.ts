import type { UrlSafetyResult } from "@/lib/urlSafety";
import type { HopOutcome } from "@/services/extraction/safeFetch";

export type ResolutionType = "none" | "short-link" | "deep-link";

export type ResolvedUrl = {
  ok: true;
  inputUrl: string;
  /** The http(s) product page to fetch. */
  canonicalUrl: string;
  provider: "zigzag" | "generic" | "none";
  resolutionType: ResolutionType;
  redirectCount: number;
  extractedProductId?: string;
  /** True when the address was built from a product id instead of read from the link's own data. */
  derivedFromId?: boolean;
};

export type ResolutionFailure = {
  ok: false;
  code: "invalid_url" | "blocked_url" | "unresolved_share_link";
  message: string;
};

export type ResolveOutcome = ResolvedUrl | ResolutionFailure;

export const UNRESOLVED_MESSAGE = "이 공유 링크에서 실제 상품 페이지를 찾지 못했어요.";

/** Everything a resolver may touch, injectable so the network and the clock can be faked in tests. */
export type ResolveContext = {
  hop: (url: string, timeoutMs: number) => Promise<HopOutcome>;
  validate: (rawUrl: string) => UrlSafetyResult;
  now: () => number;
  /** Absolute time (ms) after which the resolver gives up. */
  deadline: number;
  maxRedirects: number;
};

/** One provider's way of turning a share / short / deep link into the real product page. */
export interface ShortUrlResolver {
  readonly provider: "zigzag" | "generic";
  matches(url: URL): boolean;
  resolve(url: URL, ctx: ResolveContext): Promise<ResolveOutcome>;
}
