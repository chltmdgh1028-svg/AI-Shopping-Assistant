import { lookup } from "node:dns/promises";
import { isBlockedIp, validateHttpUrl, urlSafetyMessage } from "@/lib/urlSafety";
import { UnavailableProductExtractionProvider, type ProductExtractionProvider } from "@/services/extraction/aiProvider";
import { extractProductFromHtml, extractVisibleText } from "@/services/extraction/htmlExtraction";
import type { ProductFacts } from "@/types/shopping";

const maxBytes = 1_500_000;
const timeoutMs = 8000;

export type UrlExtractionResult =
  | { ok: true; product: ProductFacts; partial: boolean }
  | { ok: false; code: "invalid_url" | "blocked_url" | "fetch_failed" | "unsupported_content" | "too_large" | "empty_result"; message: string };

export async function extractProductFromUrl(
  rawUrl: string,
  aiProvider: ProductExtractionProvider = new UnavailableProductExtractionProvider(),
): Promise<UrlExtractionResult> {
  const safety = validateHttpUrl(rawUrl);
  if (!safety.ok) {
    return {
      ok: false,
      code: safety.reason === "invalid_url" ? "invalid_url" : "blocked_url",
      message: urlSafetyMessage(safety.reason),
    };
  }

  const dnsSafe = await validateDnsTarget(safety.url.hostname);
  if (!dnsSafe) {
    return { ok: false, code: "blocked_url", message: "보안상 사설망으로 해석되는 주소는 자동 분석할 수 없습니다." };
  }

  const fetched = await fetchHtml(safety.url);
  if (!fetched.ok) return fetched;

  let product = extractProductFromHtml(fetched.html, safety.url.toString());
  const pageText = extractVisibleText(fetched.html);

  if (aiProvider.isAvailable()) {
    const aiProduct = await aiProvider.extract({
      url: safety.url.toString(),
      title: product.productName,
      metaDescription: product.description,
      pageText,
      structuredProduct: product,
    });
    product = mergeProductFacts(product, aiProduct);
    product.extractionMetadata = {
      strategy: [...(product.extractionMetadata?.strategy ?? []), "ai-adapter"],
      status: product.extractionMetadata?.status ?? "partial",
      confidence: product.extractionMetadata?.confidence ?? "medium",
      aiProvider: aiProvider.providerName,
      warnings: product.extractionMetadata?.warnings ?? [],
      fetchedAt: product.extractionMetadata?.fetchedAt ?? new Date().toISOString(),
    };
  } else {
    product.extractionMetadata = {
      ...(product.extractionMetadata ?? {
        strategy: ["page-text"],
        status: "partial",
        confidence: "low",
        warnings: [],
      }),
      aiProvider: "unavailable",
    };
  }

  if (!product.productName || product.productName === "상품명 미확인") {
    return { ok: false, code: "empty_result", message: "상품명을 자동으로 확인하지 못했습니다." };
  }

  const partial = Boolean(product.extractionMetadata?.warnings.length);
  return { ok: true, product, partial };
}

async function validateDnsTarget(hostname: string) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":")) {
    return !isBlockedIp(hostname);
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    return addresses.length > 0 && addresses.every((entry) => !isBlockedIp(entry.address));
  } catch {
    return false;
  }
}

async function fetchHtml(url: URL): Promise<{ ok: true; html: string } | Extract<UrlExtractionResult, { ok: false }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,application/xhtml+xml",
        "user-agent": "ShoppingAssistantBot/0.2 (+local-development)",
      },
    });

    if (!response.ok) {
      return { ok: false, code: "fetch_failed", message: `상품 페이지를 읽지 못했습니다. HTTP ${response.status}` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { ok: false, code: "unsupported_content", message: "HTML 상품 페이지가 아닌 응답은 분석할 수 없습니다." };
    }

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > maxBytes) {
      return { ok: false, code: "too_large", message: "페이지가 너무 커서 자동 분석을 중단했습니다." };
    }

    const html = await readLimitedResponse(response);
    return { ok: true, html };
  } catch {
    return { ok: false, code: "fetch_failed", message: "쇼핑몰 페이지를 읽는 중 문제가 발생했습니다." };
  } finally {
    clearTimeout(timeout);
  }
}

async function readLimitedResponse(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > maxBytes) {
      await reader.cancel();
      throw new Error("Response too large");
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

function mergeProductFacts(base: ProductFacts, patch: Partial<ProductFacts>): ProductFacts {
  return {
    ...base,
    ...patch,
    images: patch.images?.length ? patch.images : base.images,
    materials: patch.materials?.length ? patch.materials : base.materials,
    sizes: patch.sizes?.length ? patch.sizes : base.sizes,
    careInstructions: patch.careInstructions?.length ? patch.careInstructions : base.careInstructions,
  };
}
