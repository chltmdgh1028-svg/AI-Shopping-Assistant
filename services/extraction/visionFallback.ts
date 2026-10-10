import {
  ExtractionProviderError,
  type ImageInput,
  type ProductExtractionProvider,
} from "@/services/extraction/aiProvider";
import type { StageRecord } from "@/services/extraction/adapters/types";
import type { ImageFetchResult } from "@/services/extraction/safeFetch";
import type { DetailField, ProductFacts } from "@/types/shopping";

export const VISION_LIMITS = {
  /** Images sent to the model in one request. */
  maxImages: 8,
  /** Decoded bytes across all images. Base64 adds a third; the request limit is 20MB. */
  maxTotalBytes: 10_000_000,
  /** Time allowed for downloading the images, shared by all of them. */
  fetchBudgetMs: 7_000,
  concurrency: 4,
  /** Below this much time left in the request, the model is not called at all. */
  minBudgetMs: 14_000,
  /** Longest the model call may take. */
  maxCallMs: 38_000,
} as const;

export type ImageFetcher = (url: string, timeoutMs: number) => Promise<ImageFetchResult>;

/**
 * Which images to read. Product detail pages open with look-book photos and close with the tables and notices, so when
 * there are more than the limit the first two and the last ones are kept.
 */
export function pickDetailImages(urls: string[], max: number = VISION_LIMITS.maxImages): string[] {
  const unique = [...new Set(urls)];
  if (unique.length <= max) return unique;
  const head = Math.min(2, max);
  return [...unique.slice(0, head), ...unique.slice(unique.length - (max - head))];
}

/** Downloads the chosen images through the guarded fetcher, in parallel, within one time budget and one byte budget. */
export async function loadDetailImages(urls: string[], fetchImage: ImageFetcher, budgetMs: number = VISION_LIMITS.fetchBudgetMs) {
  const fetched: Array<{ url: string; image: ImageInput; bytes: number } | undefined> = new Array(urls.length);
  let next = 0;

  const worker = async () => {
    while (next < urls.length) {
      const index = next++;
      const result = await fetchImage(urls[index], budgetMs).catch(() => undefined);
      if (result?.ok) fetched[index] = { url: urls[index], image: { mimeType: result.mimeType, data: result.bytes.toString("base64") }, bytes: result.bytes.length };
    }
  };
  await Promise.all(Array.from({ length: Math.min(VISION_LIMITS.concurrency, urls.length) }, worker));

  const images: ImageInput[] = [];
  let total = 0;
  let skipped = 0;
  for (const item of fetched) {
    if (!item || total + item.bytes > VISION_LIMITS.maxTotalBytes) {
      skipped += 1;
      continue;
    }
    total += item.bytes;
    images.push(item.image);
  }
  return { images, skipped };
}

export type VisionRun = {
  product: ProductFacts;
  warnings: string[];
  stage?: StageRecord;
};

/**
 * Last resort for blend, size and care: read the detail-page images. It runs only for what the text stages left empty,
 * and it only ever fills those fields; a value read from text is never replaced by one read from an image.
 */
export async function runVisionFallback(args: {
  product: ProductFacts;
  imageUrls: string[];
  provider: ProductExtractionProvider;
  remainingMs: number;
  fetchImage: ImageFetcher;
  pageUrl: string;
}): Promise<VisionRun> {
  const { product, provider } = args;
  const want: Array<"materials" | "sizes" | "care"> = [
    ...(product.materials.length === 0 ? (["materials"] as const) : []),
    ...(product.sizes.length === 0 ? (["sizes"] as const) : []),
    ...(!product.careInstructions?.length ? (["care"] as const) : []),
  ];
  if (want.length === 0) return { product, warnings: [] };

  const record = (vision: NonNullable<ProductFacts["extractionMetadata"]>["vision"], extra: Partial<NonNullable<ProductFacts["extractionMetadata"]>> = {}): ProductFacts => ({
    ...product,
    extractionMetadata: { ...product.extractionMetadata!, ...extra, vision },
  });
  const skipped = (reason: string, warning?: string): VisionRun => ({
    product: record({ status: "skipped", fields: [], imagesRead: 0, imagesSkipped: 0, reason }),
    warnings: warning ? [warning] : [],
  });

  if (!provider.isAvailable() || !provider.extractFromImages) return skipped("vision_unavailable");
  if (args.imageUrls.length === 0) return skipped("no_detail_images");
  if (args.remainingMs < VISION_LIMITS.minBudgetMs) return skipped("no_time", "시간이 부족해 상세 이미지 분석은 건너뛰었어요.");

  const startedAt = Date.now();
  const chosen = pickDetailImages(args.imageUrls);
  const { images, skipped: dropped } = await loadDetailImages(chosen, args.fetchImage, Math.min(VISION_LIMITS.fetchBudgetMs, args.remainingMs * 0.4));
  const imagesSkipped = dropped + (args.imageUrls.length - chosen.length);
  if (images.length === 0) {
    return {
      product: record({ status: "failed", fields: [], imagesRead: 0, imagesSkipped, reason: "images_unreadable" }),
      warnings: ["상세 이미지를 불러오지 못해 이미지 속 정보는 반영하지 못했어요."],
    };
  }

  const budgetMs = Math.min(VISION_LIMITS.maxCallMs, args.remainingMs - (Date.now() - startedAt) - 1_500);
  if (budgetMs < 10_000) return skipped("no_time", "시간이 부족해 상세 이미지 분석은 건너뛰었어요.");

  let result;
  try {
    result = await provider.extractFromImages({ url: args.pageUrl, images, want, budgetMs });
  } catch (error) {
    const reason = error instanceof ExtractionProviderError ? error.code : "upstream";
    return {
      product: record({ status: "failed", fields: [], imagesRead: images.length, imagesSkipped, reason }),
      warnings: ["상세 이미지 분석에 문제가 있어 이미지 속 정보는 반영하지 못했어요."],
    };
  }

  // Fill-only: each field is taken from the image only if the text stages left it empty.
  const filled: DetailField[] = [];
  const next: ProductFacts = { ...product };
  if (want.includes("materials") && result.materials.length > 0) {
    next.materials = result.materials;
    filled.push("materials");
  }
  if (want.includes("sizes") && result.sizes.length > 0) {
    next.sizes = result.sizes;
    filled.push("sizes");
  }
  if (want.includes("care") && result.careInstructions.length > 0) {
    next.careInstructions = result.careInstructions;
    filled.push("care");
  }

  const visionBase = { fields: filled as Array<"materials" | "sizes" | "care">, imagesRead: images.length, imagesSkipped, model: result.model };
  if (filled.length === 0) {
    return {
      product: { ...next, extractionMetadata: { ...product.extractionMetadata!, vision: { ...visionBase, status: "no_result", reason: "nothing_readable" } } },
      warnings: result.warnings,
    };
  }

  const labels = { materials: "소재", sizes: "사이즈", care: "관리법" } as const;
  return {
    product: {
      ...next,
      extractionMetadata: {
        ...product.extractionMetadata!,
        strategy: [...product.extractionMetadata!.strategy, "image-vision"],
        vision: { ...visionBase, status: "used" },
      },
    },
    warnings: [...result.warnings, `${filled.map((field) => labels[field as keyof typeof labels]).join("·")}은 상세 이미지에서 AI가 읽은 값이라 참고용이에요.`],
    stage: { source: "product-detail-image-vision", fields: filled },
  };
}
