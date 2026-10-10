import {
  ExtractionProviderError,
  UnavailableProductExtractionProvider,
  type ExtractionErrorCode,
  type ProductExtractionProvider,
} from "@/services/extraction/aiProvider";
import { applyBundle, buildPricing, formatPrice } from "@/domain/pricing";
import { extractWithAdapter, type ProductAdapterResult } from "@/services/extraction/adapters";
import type { StageRecord } from "@/services/extraction/adapters/types";
import type { JsonPoster } from "@/services/extraction/adapters/zigzagDetailApi";
import { extractProductFromHtml, extractVisibleText } from "@/services/extraction/htmlExtraction";
import { resolveProductUrl, type ResolveOutcome } from "@/services/extraction/resolution";
import { FETCH_LIMITS, fetchPublicHtml, fetchPublicImage, fetchPublicJson, type SafeFetchResult } from "@/services/extraction/safeFetch";
import { runVisionFallback, type ImageFetcher } from "@/services/extraction/visionFallback";
import type { ProductFacts } from "@/types/shopping";

export type UrlExtractionResult =
  | { ok: true; product: ProductFacts; partial: boolean }
  | {
      ok: false;
      code: "invalid_url" | "blocked_url" | "unresolved_share_link" | "fetch_failed" | "unsupported_content" | "too_large" | "empty_result";
      message: string;
    };

type Fetcher = (url: string) => Promise<SafeFetchResult>;
type Resolver = (url: string) => Promise<ResolveOutcome>;

export type ExtractionOptions = {
  /** Calls a site's own JSON API (the size tab). Defaults to the guarded fetcher. */
  postJson?: JsonPoster;
  /** Downloads a detail image for the vision fallback. Defaults to the guarded fetcher. */
  fetchImage?: ImageFetcher;
  /** Whole-request budget the later stages must fit in (the route allows 60s). */
  budgetMs?: number;
  now?: () => number;
};

// The route allows 60s. Link resolution, the page fetch and the model chain have their own limits; this is what the
// optional detail stages (size API, image reading) are measured against so they never push the request past it.
export const REQUEST_BUDGET_MS = 54_000;

const defaultPostJson: JsonPoster = async (url, body) => {
  const result = await fetchPublicJson(url, body);
  return result.ok ? { ok: true, data: result.data } : { ok: false };
};
const defaultFetchImage: ImageFetcher = (url, timeoutMs) => fetchPublicImage(url, { limits: { ...FETCH_LIMITS, timeoutMs } });

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
  resolver: Resolver = resolveProductUrl,
  options: ExtractionOptions = {},
): Promise<UrlExtractionResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  // A share, short or deep link is turned into the real product page first. An ordinary URL passes straight through.
  const resolved = await resolver(rawUrl);
  if (!resolved.ok) return resolved;
  const resolvedAt = now();

  const fetched = await fetcher(resolved.canonicalUrl);
  if (!fetched.ok) return fetched;
  const fetchedAt = now();

  const sourceUrl = fetched.finalUrl;
  // Pages that ship their product as script JSON are read from that data first, with no rendering.
  const adapter = extractWithAdapter(fetched.html, sourceUrl);
  const parsed = extractProductFromHtml(fetched.html, sourceUrl);
  let base = adapter ? mergeAdapterProduct(parsed, adapter) : parsed;

  // Stage 2: what the page holds only behind a click (the size tab) is read from the site's own API, not by clicking.
  const stages: StageRecord[] = adapter ? [adapter.stage] : [];
  const stageNotes: string[] = [...(adapter?.warnings ?? [])];
  let sizeApiMs: number | undefined;
  if (adapter?.enrich) {
    const apiStarted = now();
    try {
      const extra = await adapter.enrich(options.postJson ?? defaultPostJson);
      if (extra) {
        base = fillEmpty(base, extra.product);
        stages.push(extra.stage);
        stageNotes.push(...extra.warnings);
        base.extractionMetadata = base.extractionMetadata && { ...base.extractionMetadata, warnings: [...buildWarnings(base, true), ...stageNotes] };
      }
    } catch {
      // The extra stage is optional; the page's own data already stands.
    }
    sizeApiMs = now() - apiStarted;
  }
  // The adapter's text comes first: it is the page's real content, and the model reads only the first 18,000 characters.
  const pageText = [adapter?.text, extractVisibleText(fetched.html)].filter(Boolean).join("\n");
  const hasStructuredData = Boolean(adapter) || (base.extractionMetadata?.strategy.includes("json-ld") ?? false);
  const baseMetadata = base.extractionMetadata ?? { strategy: ["page-text" as const], status: "partial" as const, confidence: "low" as const, warnings: [], aiProvider: "unavailable" as const };

  let product: ProductFacts = base;

  const textAiStarted = now();
  if (aiProvider.isAvailable()) {
    try {
      const ai = await aiProvider.extract({
        url: sourceUrl,
        title: base.productName,
        metaDescription: base.description,
        pageText,
        structuredProduct: base,
      });
      product = mergeProductFacts(base, ai.product, hasStructuredData, Boolean(adapter));
      product.extractionMetadata = {
        ...baseMetadata,
        strategy: [...baseMetadata.strategy, "ai-adapter"],
        confidence: ai.confidence,
        aiProvider: aiProvider.providerName,
        aiStatus: "used",
        aiModel: ai.model,
        warnings: [...buildWarnings(product, hasStructuredData), ...stageNotes, ...ai.warnings],
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

  const textAiMs = aiProvider.isAvailable() ? now() - textAiStarted : undefined;

  if (!product.productName || product.productName === "상품명 미확인") {
    return { ok: false, code: "empty_result", message: "상품명을 자동으로 확인하지 못했습니다." };
  }

  product.pricing = applyBundle(product.pricing, product.productName, pageText);

  // Stage 4: when blend, size or care are still empty, read the detail-page images. Fill-only; text values are kept.
  let visionMs: number | undefined;
  if (adapter) {
    const remainingMs = (options.budgetMs ?? REQUEST_BUDGET_MS) - (now() - startedAt);
    const visionStarted = now();
    const vision = await runVisionFallback({
      product,
      imageUrls: adapter.detailImageUrls,
      provider: aiProvider,
      remainingMs,
      fetchImage: options.fetchImage ?? defaultFetchImage,
      pageUrl: sourceUrl,
    });
    product = vision.product;
    visionMs = product.extractionMetadata?.vision ? now() - visionStarted : undefined;
    if (vision.stage) stages.push(vision.stage);
    if (vision.warnings.length > 0 || vision.stage) {
      const filled = vision.stage?.fields ?? [];
      // A blend or size that an image supplied is no longer "missing", so its notice is dropped.
      const stillTrue = product.extractionMetadata!.warnings.filter(
        (line) => !(filled.includes("materials") && line.startsWith("소재 혼용률을")) && !(filled.includes("sizes") && line.startsWith("사이즈표를")),
      );
      product.extractionMetadata = { ...product.extractionMetadata!, warnings: [...stillTrue, ...vision.warnings] };
    }
  }
  if (stages.length > 0) product.extractionMetadata = { ...product.extractionMetadata!, detailSources: stages };
  product.extractionMetadata = {
    ...product.extractionMetadata!,
    timingsMs: { resolve: resolvedAt - startedAt, page: fetchedAt - resolvedAt, sizeApi: sizeApiMs, textAi: textAiMs, vision: visionMs, total: now() - startedAt },
  };

  if (resolved.provider !== "none" && resolved.resolutionType !== "none") {
    product.extractionMetadata = {
      ...product.extractionMetadata!,
      resolution: {
        provider: resolved.provider,
        resolutionType: resolved.resolutionType,
        inputUrl: resolved.inputUrl,
        canonicalUrl: resolved.canonicalUrl,
        redirectCount: resolved.redirectCount,
        extractedProductId: resolved.extractedProductId,
        derivedFromId: resolved.derivedFromId,
      },
    };
  }

  const hasMaterials = product.materials.length > 0;
  const hasSizes = product.sizes.length > 0;
  product.extractionMetadata = { ...product.extractionMetadata!, status: hasMaterials && hasSizes ? "complete" : hasMaterials || hasSizes ? "partial" : "failed" };

  const partial = product.extractionMetadata.status !== "complete" || product.extractionMetadata.warnings.length > 0;
  return { ok: true, product, partial };
}

/**
 * Structured data (JSON-LD) wins for identity and price. Gemini fills what the page text leaves
 * undetermined and replaces the regex guesses for materials, sizes and care, because it has already
 * been checked against the page text.
 */
export function mergeProductFacts(base: ProductFacts, ai: Partial<ProductFacts>, hasStructuredData: boolean, keepBaseFacts = false): ProductFacts {
  // A site adapter reads exact values from the page's own data; the model then only fills what it left empty.
  const prefer = <T,>(fromBase: T[], fromAi: T[] | undefined) => (keepBaseFacts && fromBase.length > 0 ? fromBase : fromAi?.length ? fromAi : fromBase);
  return {
    ...base,
    productName: (hasStructuredData ? base.productName : ai.productName) || base.productName,
    brand: base.brand || ai.brand,
    category: base.category !== "unknown" ? base.category : (ai.category ?? "unknown"),
    ...mergePricing(base, ai),
    description: base.description || ai.description || "",
    materials: prefer(base.materials, ai.materials),
    sizes: prefer(base.sizes, ai.sizes),
    fit: keepBaseFacts ? (base.fit ?? ai.fit) : (ai.fit ?? base.fit),
    careInstructions: prefer(base.careInstructions ?? [], ai.careInstructions),
  };
}

/**
 * Price priority is JSON-LD, meta, page, then Gemini. So the page-derived price always wins; Gemini only fills
 * a missing price, or a missing list price when it agrees with the page on currency.
 */
function mergePricing(base: ProductFacts, ai: Partial<ProductFacts>): Pick<ProductFacts, "pricing" | "price" | "currency"> {
  let pricing = base.pricing;
  if (!pricing) pricing = ai.pricing;
  else if (pricing.originalPrice === undefined && ai.pricing?.originalPrice && ai.pricing.currency === pricing.currency) {
    pricing =
      buildPricing({ ...pricing, originalPrice: ai.pricing.originalPrice, note: pricing.note ?? "정가는 AI가 페이지에서 추출했어요." }) ?? pricing;
  }
  return {
    pricing,
    price: pricing ? formatPrice(pricing.currentPrice, pricing.currency) : base.price,
    currency: pricing?.currency ?? base.currency,
  };
}

function buildWarnings(product: ProductFacts, hasStructuredData: boolean) {
  const warnings: string[] = [];
  if (!hasStructuredData) warnings.push("JSON-LD Product 구조화 데이터를 찾지 못했습니다.");
  if (product.materials.length === 0) warnings.push("소재 혼용률을 자동으로 확인하지 못했습니다.");
  if (product.sizes.length === 0) warnings.push("사이즈표를 자동으로 확인하지 못했습니다.");
  if (!product.pricing) warnings.push("가격을 자동으로 확인하지 못했습니다.");
  return warnings;
}

/** Fields read from the page's own data win over the generic reader's guesses; the rest stay as they were. */
function mergeAdapterProduct(parsed: ProductFacts, adapter: ProductAdapterResult): ProductFacts {
  const found = adapter.product;
  const merged: ProductFacts = {
    ...parsed,
    productName: found.productName || parsed.productName,
    brand: found.brand ?? parsed.brand,
    category: found.category && found.category !== "unknown" ? found.category : parsed.category,
    ...(found.pricing ? { pricing: found.pricing, price: found.price, currency: found.currency } : {}),
    images: Array.from(new Set([...(found.images ?? []), ...parsed.images])),
    description: found.description || parsed.description,
    materials: found.materials?.length ? found.materials : parsed.materials,
    sizes: found.sizes?.length ? found.sizes : parsed.sizes,
    fit: found.fit ?? parsed.fit,
    // The adapter reads real instructions only; the generic reader would also pick up "세탁 가이드 바로가기" style text.
    careInstructions: found.careInstructions ?? parsed.careInstructions,
  };
  const metadata = parsed.extractionMetadata;
  if (metadata) {
    merged.extractionMetadata = {
      ...metadata,
      strategy: [...metadata.strategy.filter((item) => item !== "page-text"), "hydration", "page-text"],
      confidence: "medium",
      warnings: [...buildWarnings(merged, true), ...adapter.warnings],
    };
  }
  return merged;
}

/** Fills only what is empty: an earlier stage's value is never replaced by a later one. */
function fillEmpty(base: ProductFacts, extra: Partial<ProductFacts>): ProductFacts {
  return {
    ...base,
    materials: base.materials.length > 0 ? base.materials : (extra.materials ?? base.materials),
    sizes: base.sizes.length > 0 ? base.sizes : (extra.sizes ?? base.sizes),
    careInstructions: base.careInstructions?.length ? base.careInstructions : (extra.careInstructions ?? base.careInstructions),
  };
}
