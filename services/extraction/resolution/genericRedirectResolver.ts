import type { WebCandidate } from "@/services/extraction/resolution/candidates";
import { traceShareLink, type Accepted, type TracePolicy } from "@/services/extraction/resolution/trace";
import type { ResolveContext, ResolveOutcome, ShortUrlResolver } from "@/services/extraction/resolution/types";

// Link shorteners and deep-link services. A product page on any other host passes through untouched.
const shareHosts = new Set(["abr.ge", "bit.ly", "bnc.lt", "app.link", "onelink.me", "kko.to", "me2.do", "naver.me", "buly.kr", "han.gl", "vo.la", "tinyurl.com"]);

const isShareHost = (host: string) => shareHosts.has(host) || [...shareHosts].some((known) => host.endsWith(`.${known}`));

function acceptAnyProductPage(candidate: WebCandidate): Accepted | undefined {
  let url: URL;
  try {
    url = new URL(candidate.url);
  } catch {
    return undefined;
  }
  // Still inside the shortener: keep following. Anywhere else is where the link was pointing.
  return isShareHost(url.hostname.toLowerCase()) ? undefined : { url: url.toString() };
}

const policy: TracePolicy = { provider: "generic", accept: acceptAnyProductPage };

/** Follows any known shortener or deep-link host to wherever it points. Provider-specific rules live in their own resolver. */
export class GenericRedirectResolver implements ShortUrlResolver {
  readonly provider = "generic" as const;

  matches(url: URL) {
    return isShareHost(url.hostname.toLowerCase());
  }

  resolve(url: URL, ctx: ResolveContext): Promise<ResolveOutcome> {
    return traceShareLink(url, ctx, policy);
  }
}
