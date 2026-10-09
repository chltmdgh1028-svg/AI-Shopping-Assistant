import {
  ExtractionProviderError,
  UnavailableProductExtractionProvider,
  type ExtractionErrorCode,
  type ProductExtractionProvider,
} from "@/services/extraction/aiProvider";
import { extractProductFromHtml, extractVisibleText } from "@/services/extraction/htmlExtraction";
import { fetchPublicHtml, type SafeFetchResult } from "@/services/extraction/safeFetch";
import type { ProductFacts } from "@/types/shopping";

export type UrlExtractionResult =
  | { ok: true; product: ProductFacts; partial: boolean }
  | { ok: false; code: "invalid_url" | "blocked_url" | "fetch_failed" | "unsupported_content" | "too_large" | "empty_result"; message: string };

type Fetcher = (url: string) => Promise<SafeFetchResult>;

const aiFailureMessages: Record<ExtractionErrorCode, string> = {
  quota: "AI 분석 사용량이 일시적으로 가득 차 페이지에서 직접 읽은 정보만 사용했어요.",
  timeout: "AI 분석이 너무 오래 걸려 페이지에서 직접 읽은 정보만 사용했어요.",
  invalid_output: "AI 분석 결과를 확인하지 못해 페이지에서 직접 읽은 정보만 사용했어요.",
  auth: "AI 분석 설정에 문제가 있어 페이지에서 직접 읽은 정보만 사용했어요.",
  model: "AI 분석 설정에 문제가 있어 페이지에서 직접 읽은 정보만 사용했어요.",
  upstream: "AI 분석에 일시적인 문제가 있어 페이지에서 직접 읽은 정보만 사용했어요.",
};

export async function extractProductFromUrl(
  rawUrl: string,
  aiProvider: ProductExtractionProvider = new UnavailableProductExtractionProvider(),
  fetcher: Fetcher = fetchPublicHtml,
): Promise<UrlExtractionResult> {
  const fetched = await fetcher(rawUrl);
  if (!fetched.ok) return fetched;

  const sourceUrl = fetched.finalUrl;
  const base = extractProductFromHtml(fetched.html, sourceUrl);
  const pageText = extractVisibleText(fetched.html);
  const hasStructuredData = base.extractionMetadata?.strategy.includes("json-ld") ?? false;
  const baseMetadata = base.extractionMetadata ?? { strategy: ["page-text" as const], status: "partial" as const, confidence: "low" as const, warnings: [], aiProvider: "unavailable" as const };

  let product: ProductFacts = base;

  if (aiProvider.isAvailable()) {
    try {
      const ai = await aiProvider.extract({
        url: sourceUrl,
        title: base.productName,
        metaDescription: base.description,
        pageText,
        structuredProduct: base,
      });
      product = mergeProductFacts(base, ai.product, hasStructuredData);
      product.extractionMetadata = {
        ...baseMetadata,
        strategy: [...baseMetadata.strategy, "ai-adapter"],
        confidence: ai.confidence,
        aiProvider: aiProvider.providerName,
        aiStatus: "used",
        warnings: [...buildWarnings(product, hasStructuredData), ...ai.warnings],
      };
    } catch (error) {
      const code = error instanceof ExtractionProviderError ? error.code : "upstream";
      product.extractionMetadata = {
        ...baseMetadata,
        aiProvider: "unavailable",
        aiStatus: "failed",
        warnings: [...baseMetadata.warnings, aiFailureMessages[code]],
      };
    }
  } else {
    product.extractionMetadata = { ...baseMetadata, aiProvider: "unavailable", aiStatus: "not_configured" };
  }

  if (!product.productName || product.productName === "상품명 미확인") {
    return { ok: false, code: "empty_result", message: "상품명을 자동으로 확인하지 못했습니다." };
  }

  const metadata = product.extractionMetadata;
  const hasMaterials = product.materials.length > 0;
  const hasSizes = product.sizes.length > 0;
  product.extractionMetadata = { ...metadata, status: hasMaterials && hasSizes ? "complete" : hasMaterials || hasSizes ? "partial" : "failed" };

  const partial = product.extractionMetadata.status !== "complete" || product.extractionMetadata.warnings.length > 0;
  return { ok: true, product, partial };
}

/**
 * Structured data (JSON-LD) wins for identity and price. Gemini fills what the page text leaves
 * undetermined and replaces the regex guesses for materials, sizes and care, because it has already
 * been checked against the page text.
 */
export function mergeProductFacts(base: ProductFacts, ai: Partial<ProductFacts>, hasStructuredData: boolean): ProductFacts {
  return {
    ...base,
    productName: (hasStructuredData ? base.productName : ai.productName) || base.productName,
    brand: base.brand || ai.brand,
    category: base.category !== "unknown" ? base.category : (ai.category ?? "unknown"),
    price: base.price || ai.price,
    currency: base.currency || ai.currency,
    description: base.description || ai.description || "",
    materials: ai.materials?.length ? ai.materials : base.materials,
    sizes: ai.sizes?.length ? ai.sizes : base.sizes,
    fit: ai.fit ?? base.fit,
    careInstructions: ai.careInstructions?.length ? ai.careInstructions : base.careInstructions,
  };
}

function buildWarnings(product: ProductFacts, hasStructuredData: boolean) {
  const warnings: string[] = [];
  if (!hasStructuredData) warnings.push("JSON-LD Product 구조화 데이터를 찾지 못했습니다.");
  if (product.materials.length === 0) warnings.push("소재 혼용률을 자동으로 확인하지 못했습니다.");
  if (product.sizes.length === 0) warnings.push("사이즈표를 자동으로 확인하지 못했습니다.");
  return warnings;
}
