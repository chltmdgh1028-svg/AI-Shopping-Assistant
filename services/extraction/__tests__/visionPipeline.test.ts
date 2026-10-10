// @vitest-environment node
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { ExtractionProviderError, type CandidateScanInput, type ImageExtractionInput, type ImageExtractionResult, type ProductExtractionProvider } from "@/services/extraction/aiProvider";
import type { Tile } from "@/services/extraction/imageProcessing";
import type { Candidates } from "@/services/extraction/visionCandidates";
import {
  batchTiles,
  loadDetailImages,
  orderDetailTiles,
  pickSheetCells,
  prioritizeImages,
  runVisionFallback,
  VISION_LIMITS,
  type ImageFetcher,
} from "@/services/extraction/visionFallback";
import type { ProductFacts } from "@/types/shopping";

/** White page with dark bars: scores high as "looks like a table". */
async function table(width = 800, height = 900) {
  const bars = Array.from({ length: Math.floor(height / 60) }, (_, row) => `<rect x="40" y="${row * 60 + 20}" width="${width - 80}" height="14" fill="#222"/>`).join("");
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#fff"/>${bars}</svg>`)).jpeg().toBuffer();
}
const photo = (width = 800, height = 900) => sharp({ create: { width, height, channels: 3, background: "#7a5c46" } }).jpeg().toBuffer();

const url = (index: number) => `https://img.example.com/${index}.jpg`;
const urls = (count: number) => Array.from({ length: count }, (_, index) => url(index + 1));
const fetcherFor = (images: Record<number, Buffer>): ImageFetcher => async (address) => {
  const bytes = images[Number(address.match(/(\d+)\.jpg$/)?.[1])];
  return bytes ? { ok: true, bytes, mimeType: "image/jpeg", finalUrl: address } : { ok: false, code: "fetch_failed", message: "x" };
};

const baseProduct = (overrides: Partial<ProductFacts> = {}): ProductFacts =>
  ({
    productName: "니트",
    category: "knitwear",
    images: [],
    description: "",
    materials: [],
    sizes: [],
    careInstructions: [],
    factsSource: "product_page",
    extractionMetadata: { strategy: ["hydration"], status: "partial", confidence: "medium", aiProvider: "unavailable", warnings: [] },
    ...overrides,
  }) as unknown as ProductFacts;

const cotton = [
  { name: "Cotton", percentage: 60, source: "image-vision" as const, confidence: "medium" as const },
  { name: "Polyester", percentage: 40, source: "image-vision" as const, confidence: "medium" as const },
];
const freeSize = [{ name: "FREE", chest: 100, length: 60, unit: "cm" as const, source: "image-vision" as const, confidence: "medium" as const }];

function provider(options: { scan?: Candidates | Error | "missing"; detail?: Partial<ImageExtractionResult> | Error } = {}) {
  const scanDetailImages = vi.fn(async (input: CandidateScanInput) => {
    void input;
    if (options.scan instanceof Error) throw options.scan;
    return { candidates: (options.scan as Candidates | undefined) ?? { materials: [], sizes: [], care: [] }, model: "gemini-3.5-flash-lite" };
  });
  const extractFromImages = vi.fn(async (input: ImageExtractionInput) => {
    void input;
    if (options.detail instanceof Error) throw options.detail;
    return { materials: [], sizes: [], careInstructions: [], confidence: "medium" as const, warnings: [], evidence: [], model: "gemini-3.5-flash-lite", ...options.detail };
  });
  const value: ProductExtractionProvider = {
    providerName: "gemini",
    isAvailable: () => true,
    extract: async () => ({ product: {}, confidence: "low", warnings: [] }),
    extractFromImages,
    ...(options.scan === "missing" ? {} : { scanDetailImages }),
  };
  return { provider: value, scanDetailImages, extractFromImages };
}

const run = (args: { product?: ProductFacts; count: number; images: Record<number, Buffer>; provider: ProductExtractionProvider; remainingMs?: number }) =>
  runVisionFallback({ product: args.product ?? baseProduct(), imageUrls: urls(args.count), provider: args.provider, remainingMs: args.remainingMs ?? 40_000, fetchImage: fetcherFor(args.images), pageUrl: "https://zigzag.kr/p/1" });

/** A page of photographs with a size table at image 17 and a long fabric notice at image 19. */
async function lookbook() {
  const images: Record<number, Buffer> = {};
  for (let index = 1; index <= 24; index += 1) images[index] = await photo();
  images[17] = await table(800, 900);
  images[19] = await table(860, 4200);
  return images;
}

describe("when the image stage starts", () => {
  it("does not start at all when the blend and the size are known, even though care is missing", async () => {
    const { provider: model, scanDetailImages, extractFromImages } = provider({ detail: { careInstructions: ["단독 손세탁"] } });
    const outcome = await run({ product: baseProduct({ materials: cotton, sizes: freeSize }), count: 20, images: await lookbook(), provider: model });
    expect(scanDetailImages).not.toHaveBeenCalled();
    expect(extractFromImages).not.toHaveBeenCalled();
    expect(outcome.product.extractionMetadata?.vision).toBeUndefined();
    expect(outcome.stage).toBeUndefined();
  });

  it("asks for the blend only when only the blend is missing, and the size only when only the size is", async () => {
    const needsBlend = provider({ detail: { materials: cotton } });
    await run({ product: baseProduct({ sizes: freeSize, careInstructions: ["단독 손세탁"] }), count: 3, images: { 1: await table(), 2: await photo(), 3: await photo() }, provider: needsBlend.provider });
    expect(needsBlend.extractFromImages.mock.calls[0][0].want).toEqual(["materials"]);

    const needsSize = provider({ detail: { sizes: freeSize } });
    await run({ product: baseProduct({ materials: cotton, careInstructions: ["단독 손세탁"] }), count: 3, images: { 1: await table(), 2: await photo(), 3: await photo() }, provider: needsSize.provider });
    expect(needsSize.extractFromImages.mock.calls[0][0].want).toEqual(["sizes"]);

    const needsBoth = provider({ detail: { materials: cotton, sizes: freeSize } });
    await run({ product: baseProduct(), count: 3, images: { 1: await table(), 2: await photo(), 3: await photo() }, provider: needsBoth.provider });
    expect(needsBoth.extractFromImages.mock.calls[0][0].want).toEqual(["materials", "sizes", "care"]);
  });

  it("reads a handful of images directly, without a scan", async () => {
    const { provider: model, scanDetailImages, extractFromImages } = provider({ detail: { materials: cotton } });
    const outcome = await run({ count: 4, images: { 1: await table(), 2: await photo(), 3: await photo(), 4: await photo() }, provider: model });
    expect(scanDetailImages).not.toHaveBeenCalled();
    expect(extractFromImages.mock.calls[0][0].labels).toEqual(["1", "2", "3", "4"]);
    expect(outcome.product.extractionMetadata?.vision).toMatchObject({ status: "used", mode: "direct", tiles: 4 });
  });
});

describe("finding the images worth reading", () => {
  it("builds contact sheets of the likeliest cells, asks the model to choose, then reads only the chosen tiles", async () => {
    const { provider: model, scanDetailImages, extractFromImages } = provider({ scan: { materials: ["19-2"], sizes: ["17"], care: [] }, detail: { materials: cotton, sizes: freeSize } });
    const outcome = await run({ count: 24, images: await lookbook(), provider: model });

    // One scan, with real contact-sheet images whose cell numbers are listed.
    expect(scanDetailImages).toHaveBeenCalledTimes(1);
    const scan = scanDetailImages.mock.calls[0][0];
    expect(scan.want).toEqual(["materials", "sizes", "care"]);
    expect(scan.sheets.length).toBe(scan.sheetLabels.length);
    expect(scan.sheetLabels.flat()).toEqual(expect.arrayContaining(["17", "19-1", "19-2"]));
    expect(scan.sheetLabels.every((labels) => labels.length <= 12)).toBe(true);
    const sheetMeta = await sharp(Buffer.from(scan.sheets[0].data, "base64")).metadata();
    expect(sheetMeta.format).toBe("jpeg");

    // Then one close read of the chosen tiles: the blend candidate first, then the size candidate (plus the clearest table).
    expect(extractFromImages).toHaveBeenCalledTimes(1);
    const read = extractFromImages.mock.calls[0][0];
    expect(read.labels?.slice(0, 2)).toEqual(["19-2", "17"]);
    expect(read.labels?.length).toBeLessThanOrEqual(VISION_LIMITS.batchSize);
    expect(read.images.length).toBe(read.labels?.length);

    expect(outcome.product.extractionMetadata?.vision).toMatchObject({
      status: "used",
      mode: "scan",
      candidates: { materials: ["19-2"], sizes: ["17"], care: [] },
      fields: ["materials", "sizes"],
    });
    expect(outcome.product.extractionMetadata?.vision?.durationsMs).toMatchObject({ fetch: expect.any(Number), scan: expect.any(Number), detail: expect.any(Number), total: expect.any(Number) });
  });

  it("cuts a long image into tiles and names the one a value was read from", async () => {
    const { provider: model, extractFromImages } = provider({
      scan: { materials: ["19-2"], sizes: [], care: [] },
      detail: { materials: cotton, evidence: [{ field: "materials", imageIndex: 19, tileIndex: 2, confidence: "medium" }] },
    });
    const outcome = await run({ product: baseProduct({ sizes: freeSize, careInstructions: ["x 세탁"] }), count: 24, images: await lookbook(), provider: model });
    expect(extractFromImages.mock.calls[0][0].labels?.[0]).toBe("19-2");
    expect(outcome.product.extractionMetadata?.vision?.evidence).toEqual([{ field: "materials", imageIndex: 19, tileIndex: 2, confidence: "medium" }]);
    expect(outcome.product.extractionMetadata?.vision?.tiles).toBeGreaterThan(24);
  });

  it("falls back on how table-like the tiles look when the scan fails", async () => {
    const { provider: model, extractFromImages } = provider({ scan: new ExtractionProviderError("timeout"), detail: { materials: cotton, sizes: freeSize } });
    const outcome = await run({ count: 24, images: await lookbook(), provider: model });
    const labels = extractFromImages.mock.calls[0][0].labels;
    expect(labels).toEqual(expect.arrayContaining(["17"]));
    expect(outcome.product.extractionMetadata?.vision).toMatchObject({ status: "used", mode: "heuristic" });
  });

  it("does the same when the provider cannot scan at all", async () => {
    const { provider: model, extractFromImages } = provider({ scan: "missing", detail: { materials: cotton } });
    const outcome = await run({ count: 24, images: await lookbook(), provider: model });
    expect(extractFromImages.mock.calls.length).toBeGreaterThan(0);
    expect(extractFromImages.mock.calls.length).toBeLessThanOrEqual(VISION_LIMITS.maxBatches);
    expect(outcome.product.extractionMetadata?.vision?.mode).toBe("heuristic");
  });

  it("skips the scan when too little time is left for it, and still reads the likeliest tiles", async () => {
    const { provider: model, scanDetailImages, extractFromImages } = provider({ detail: { materials: cotton } });
    const outcome = await run({ count: 24, images: await lookbook(), provider: model, remainingMs: 13_000 });
    expect(scanDetailImages).not.toHaveBeenCalled();
    expect(extractFromImages.mock.calls.length).toBeGreaterThan(0);
    expect(outcome.product.extractionMetadata?.vision?.mode).toBe("heuristic");
  });

  it("reports nothing found when the scan finds nothing and no tile looks like a table", async () => {
    const images: Record<number, Buffer> = {};
    for (let index = 1; index <= 20; index += 1) images[index] = await photo();
    const { provider: model, extractFromImages } = provider({ scan: { materials: [], sizes: [], care: [] } });
    const outcome = await run({ count: 20, images, provider: model });
    expect(extractFromImages).not.toHaveBeenCalled();
    expect(outcome.product.extractionMetadata?.vision).toMatchObject({ status: "no_result", reason: "no_candidates" });
    expect(outcome.product.materials).toEqual([]);
  });

  it("reads at most two batches of four tiles", async () => {
    const images: Record<number, Buffer> = {};
    for (let index = 1; index <= 14; index += 1) images[index] = await table(800, 900);
    const { provider: model, extractFromImages } = provider({ scan: { materials: ["1", "2", "3"], sizes: ["4", "5", "6"], care: ["7", "8", "9"] }, detail: { materials: cotton } });
    await run({ count: 14, images, provider: model });
    expect(extractFromImages.mock.calls.length).toBeLessThanOrEqual(VISION_LIMITS.maxBatches);
    for (const [call] of extractFromImages.mock.calls) expect(call.images.length).toBeLessThanOrEqual(VISION_LIMITS.batchSize);
  });
});

describe("what the image stage returns", () => {
  it("fills only the fields the text left empty and marks them image-vision", async () => {
    const { provider: model } = provider({ detail: { materials: cotton, sizes: freeSize, careInstructions: ["단독 손세탁"] } });
    const outcome = await run({ product: baseProduct({ materials: [{ name: "Wool", percentage: 100, source: "structured-data", confidence: "medium" }] }), count: 3, images: { 1: await table(), 2: await photo(), 3: await photo() }, provider: model });
    // The blend was already known, so the model's blend is ignored; the size and the care are filled.
    expect(outcome.product.materials.map((item) => item.name)).toEqual(["Wool"]);
    expect(outcome.product.sizes[0].source).toBe("image-vision");
    expect(outcome.product.careInstructions).toEqual(["단독 손세탁"]);
    expect(outcome.stage).toEqual({ source: "product-detail-image-vision", fields: ["sizes", "care"] });
    expect(outcome.warnings.join(" ")).toContain("사이즈·관리법은 상세 이미지에서 AI가 읽은 값이라 참고용이에요.");
  });

  it("returns the page's own result untouched when the model fails", async () => {
    const { provider: model } = provider({ detail: new ExtractionProviderError("quota") });
    const product = baseProduct({ sizes: freeSize });
    const outcome = await run({ product, count: 3, images: { 1: await table(), 2: await photo(), 3: await photo() }, provider: model });
    expect(outcome.product.sizes).toEqual(freeSize);
    expect(outcome.product.materials).toEqual([]);
    expect(outcome.product.extractionMetadata?.vision).toMatchObject({ status: "failed", reason: "quota" });
    expect(outcome.warnings).toHaveLength(1);
  });

  it("reports images that could not be decoded", async () => {
    const { provider: model, extractFromImages } = provider();
    const outcome = await run({ count: 3, images: { 1: Buffer.from("not an image"), 2: Buffer.from("nor this"), 3: Buffer.from("or this") }, provider: model });
    expect(extractFromImages).not.toHaveBeenCalled();
    expect(outcome.product.extractionMetadata?.vision).toMatchObject({ status: "failed", reason: "images_unreadable" });
  });

  it("is skipped quietly when the provider cannot see or there are no detail images", async () => {
    const blind: ProductExtractionProvider = { providerName: "unavailable", isAvailable: () => false, extract: async () => ({ product: {}, confidence: "low", warnings: [] }) };
    const unavailable = await run({ count: 3, images: { 1: await table() }, provider: blind });
    expect(unavailable.product.extractionMetadata?.vision).toMatchObject({ status: "skipped", reason: "vision_unavailable" });
    expect(unavailable.warnings).toEqual([]);

    const { provider: model } = provider();
    const none = await run({ count: 0, images: {}, provider: model });
    expect(none.product.extractionMetadata?.vision).toMatchObject({ status: "skipped", reason: "no_detail_images" });
  });

  it("does not start with less time than the stage needs", async () => {
    const { provider: model, extractFromImages } = provider({ detail: { materials: cotton } });
    const outcome = await run({ count: 3, images: { 1: await table() }, provider: model, remainingMs: 8_000 });
    expect(extractFromImages).not.toHaveBeenCalled();
    expect(outcome.product.extractionMetadata?.vision).toMatchObject({ status: "skipped", reason: "no_time" });
    expect(outcome.warnings.join(" ")).toContain("시간이 부족");
  });
});

describe("limits", () => {
  it("prefers the tail of a long page, then the head, and keeps each image's real position", () => {
    const picked = prioritizeImages(urls(60));
    expect(picked).toHaveLength(VISION_LIMITS.maxImages);
    expect(picked[0].index).toBe(47);
    expect(picked.map((entry) => entry.index)).toContain(60);
    expect(picked.map((entry) => entry.index)).toContain(1);
    expect(picked.map((entry) => entry.index)).not.toContain(10);
    expect(prioritizeImages(urls(20))[0].index).toBe(7);
    expect(prioritizeImages(["a", "b", "a"]).map((entry) => entry.url)).toEqual(["a", "b"]);
  });

  it("downloads in parallel within the budget and skips what fails or does not fit", async () => {
    let active = 0;
    let peak = 0;
    const fetchImage: ImageFetcher = async (address) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return address.includes("bad") ? { ok: false, code: "fetch_failed", message: "x" } : { ok: true, bytes: Buffer.alloc(10), mimeType: "image/jpeg", finalUrl: address };
    };
    const entries = ["a", "bad1", "b", "bad2", "c", "d"].map((name, index) => ({ url: `https://x/${name}.jpg`, index: index + 1 }));
    const { loaded, skipped } = await loadDetailImages(entries, fetchImage, { budgetMs: 1000, concurrency: 3 });
    expect(loaded.map((item) => item.index)).toEqual([1, 3, 5, 6]);
    expect(skipped).toBe(2);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("stops downloading when the byte budget is spent", async () => {
    const fetchImage: ImageFetcher = async (address) => ({ ok: true, bytes: Buffer.alloc(4_000_000), mimeType: "image/jpeg", finalUrl: address });
    const entries = Array.from({ length: 6 }, (_, index) => ({ url: `https://x/${index}.jpg`, index: index + 1 }));
    const { loaded } = await loadDetailImages(entries, fetchImage, { budgetMs: 1000, maxTotalBytes: 10_000_000, concurrency: 1 });
    expect(loaded).toHaveLength(2);
  });

  it("stops starting downloads when the time budget is spent", async () => {
    const fetchImage = vi.fn<ImageFetcher>(async (address) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return { ok: true, bytes: Buffer.alloc(10), mimeType: "image/jpeg", finalUrl: address };
    });
    const entries = Array.from({ length: 10 }, (_, index) => ({ url: `https://x/${index}.jpg`, index: index + 1 }));
    const { loaded } = await loadDetailImages(entries, fetchImage, { budgetMs: 100, concurrency: 1 });
    expect(loaded.length).toBeLessThan(10);
    expect(fetchImage.mock.calls.length).toBeLessThan(10);
  });
});

describe("choosing tiles", () => {
  const fake = (imageIndex: number, tileIndex: number, tileCount: number, score: number): Tile => ({
    imageIndex,
    tileIndex,
    tileCount,
    label: tileCount > 1 ? `${imageIndex}-${tileIndex}` : String(imageIndex),
    width: 800,
    height: 900,
    bytes: Buffer.from("x"),
    thumb: Buffer.from("x"),
    score,
  });

  it("puts the likeliest cells on the sheets, in page order", () => {
    const tiles = Array.from({ length: 40 }, (_, index) => fake(index + 1, 1, 1, index === 30 ? 0.9 : index / 100));
    const cells = pickSheetCells(tiles);
    expect(cells).toHaveLength(VISION_LIMITS.maxSheetCells);
    expect(cells.map((tile) => tile.imageIndex)).toContain(31);
    expect(cells.map((tile) => tile.imageIndex)).toEqual([...cells.map((tile) => tile.imageIndex)].sort((a, b) => a - b));
  });

  it("orders the chosen tiles blend first, then size, then care, and adds the clearest tables", () => {
    const tiles = [fake(1, 1, 1, 0.1), fake(2, 1, 1, 0.1), fake(3, 1, 1, 0.1), fake(4, 1, 1, 0.9), fake(5, 1, 1, 0.8), fake(6, 1, 1, 0.7)];
    const ordered = orderDetailTiles(tiles, { materials: ["3"], sizes: ["2"], care: ["1"] }, ["materials", "sizes", "care"]);
    expect(ordered.map((tile) => tile.label)).toEqual(["3", "2", "1", "4", "5"]);
  });

  it("ignores labels that are not tiles and kinds that were not asked about", () => {
    const tiles = [fake(1, 1, 1, 0.1), fake(2, 1, 1, 0.1)];
    expect(orderDetailTiles(tiles, { materials: ["99"], sizes: ["2"], care: ["1"] }, ["sizes"]).map((tile) => tile.label)).toEqual(["2"]);
  });

  it("splits tiles into batches", () => {
    const tiles = Array.from({ length: 8 }, (_, index) => fake(index + 1, 1, 1, 0.5));
    expect(batchTiles(tiles).map((batch) => batch.length)).toEqual([4, 4]);
    expect(batchTiles(tiles.slice(0, 5)).map((batch) => batch.length)).toEqual([4, 1]);
  });
});
