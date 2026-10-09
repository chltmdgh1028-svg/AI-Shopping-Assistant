import { NextResponse } from "next/server";
import { MAX_URL_LENGTH } from "@/lib/urlSafety";
import { clientKeyFromHeaders, createInflightDeduper, createRateLimiter } from "@/lib/requestGuard";
import { createProductExtractionProvider } from "@/services/extraction/aiProvider";
import { extractProductFromUrl, type UrlExtractionResult } from "@/services/extraction/urlExtraction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// fetch (8s) + Gemini (20s) + headroom.
export const maxDuration = 40;

const maxBodyBytes = MAX_URL_LENGTH + 256;

// Best-effort only: per-instance memory. See lib/requestGuard.ts and README "Known limitations".
const rateLimiter = createRateLimiter({ limit: 12, windowMs: 60_000 });
const deduper = createInflightDeduper<UrlExtractionResult>();

const noStore = { "cache-control": "no-store" };

function error(message: string, code: string, status: number, headers: Record<string, string> = {}) {
  return NextResponse.json({ error: message, code }, { status, headers: { ...noStore, ...headers } });
}

export async function POST(request: Request) {
  try {
    if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
      return error("JSON 요청만 받을 수 있습니다.", "invalid_request", 415);
    }

    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > maxBodyBytes) {
      return error("요청이 너무 큽니다.", "payload_too_large", 413);
    }

    const rawBody = await request.text();
    if (rawBody.length > maxBodyBytes) {
      return error("요청이 너무 큽니다.", "payload_too_large", 413);
    }

    let body: { url?: unknown };
    try {
      body = JSON.parse(rawBody) as { url?: unknown };
    } catch {
      return error("요청 형식이 올바르지 않습니다.", "invalid_request", 400);
    }

    if (typeof body.url !== "string" || body.url.trim().length === 0) {
      return error("URL이 필요합니다.", "invalid_url", 400);
    }

    const limit = rateLimiter.check(clientKeyFromHeaders(request.headers));
    if (!limit.allowed) {
      return error("요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", "rate_limited", 429, {
        "retry-after": String(limit.retryAfterSeconds),
      });
    }

    const url = body.url.trim();
    const result = await deduper.run(url, async () => extractProductFromUrl(url, await createProductExtractionProvider()));

    if (!result.ok) {
      const status = result.code === "invalid_url" || result.code === "blocked_url" ? 400 : 422;
      return error(result.message, result.code, status);
    }

    return NextResponse.json({ product: result.product, partial: result.partial }, { headers: noStore });
  } catch {
    return error("상품 URL 분석 중 예기치 못한 문제가 발생했습니다.", "unexpected_error", 500);
  }
}
