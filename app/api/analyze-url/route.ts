import { NextResponse } from "next/server";
import { extractProductFromUrl } from "@/services/extraction/urlExtraction";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { url?: unknown };
    if (typeof body.url !== "string") {
      return NextResponse.json({ error: "URL이 필요합니다.", code: "invalid_url" }, { status: 400 });
    }

    const result = await extractProductFromUrl(body.url);
    if (!result.ok) {
      const status = result.code === "invalid_url" || result.code === "blocked_url" ? 400 : 422;
      return NextResponse.json({ error: result.message, code: result.code }, { status });
    }

    return NextResponse.json({
      product: result.product,
      partial: result.partial,
    });
  } catch {
    return NextResponse.json({ error: "상품 URL 분석 중 예기치 못한 문제가 발생했습니다.", code: "unexpected_error" }, { status: 500 });
  }
}
