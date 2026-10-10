import { ExtractionProviderError, type ImageExtractionResult, type ImageInput, type ProductExtractionProvider } from "@/services/extraction/aiProvider";
import type { StageRecord } from "@/services/extraction/adapters/types";
import { buildContactSheet, SHEET, tileImage, type Tile } from "@/services/extraction/imageProcessing";
import type { ImageFetchResult } from "@/services/extraction/safeFetch";
import type { Candidates } from "@/services/extraction/visionCandidates";
import type { VisionEvidence, VisionField } from "@/services/extraction/visionSchema";
import type { DetailField, MaterialBlend, ProductFacts, ProductSize } from "@/types/shopping";

export const VISION_LIMITS = {
  /** Images downloaded to look through. The rest of a very long page is not fetched. */
  maxImages: 24,
  /** Decoded bytes across everything downloaded for the look-through. */
  maxTotalBytes: 30_000_000,
  fetchBudgetMs: 5_000,
  concurrency: 8,
  /** Up to this many tiles are simply read; more than this and candidates are picked first. */
  directReadMaxTiles: 6,
  /** Cells put on contact sheets (two sheets). */
  maxSheetCells: SHEET.cellsPerSheet * 2,
  /** Tiles sent in one detailed read, and how many reads may run side by side. */
  batchSize: 4,
  maxBatches: 2,
  /** A page with this few images (or fewer) has nothing to choose from: every tile is read, with no scan. */
  fewImages: 4,
  /** The most tiles read on such a page (three reads side by side). */
  fewImagesMaxTiles: 12,
  /** Longest one close read may take. */
  detailMaxMs: 20_000,
  /** Below this much time left in the request, the image stage is not started. */
  minBudgetMs: 12_000,
  /** The whole image stage, however much time the request has. */
  maxTotalMs: 30_000,
  scanBudgetMs: 12_000,
  /** The detailed read always keeps at least this much of the budget. */
  minDetailMs: 8_000,
  /** Tiles that look this much like a table or a notice are read even if the scan does not pick them. */
  infoScore: 0.5,
  /** With no scan to go by, tiles at least this table-like are read, best first. */
  heuristicScore: 0.25,
} as const;

export type ImageFetcher = (url: string, timeoutMs: number) => Promise<ImageFetchResult>;

type Entry = { url: string; index: number };
type Loaded = { index: number; bytes: Buffer };

/**
 * Which images to download when there are more than the limit. A detail page opens with look-book photos and closes with
 * the tables and notices, so the tail comes first, then the head, then the middle.
 */
export function prioritizeImages(urls: string[], max: number = VISION_LIMITS.maxImages): Entry[] {
  const entries = [...new Set(urls)].map((url, position) => ({ url, index: position + 1 }));
  const kept = entries.length <= max ? entries : [...entries.slice(0, 6), ...entries.slice(entries.length - (max - 6))];
  const tail = kept.slice(-14);
  return [...tail, ...kept.slice(0, kept.length - tail.length)];
}

/** Downloads the images in parallel within one time budget and one byte budget; whatever does not arrive is skipped. */
export async function loadDetailImages(
  entries: Entry[],
  fetchImage: ImageFetcher,
  options: { budgetMs?: number; maxTotalBytes?: number; concurrency?: number } = {},
): Promise<{ loaded: Loaded[]; skipped: number }> {
  const budgetMs = options.budgetMs ?? VISION_LIMITS.fetchBudgetMs;
  const maxTotal = options.maxTotalBytes ?? VISION_LIMITS.maxTotalBytes;
  const deadline = Date.now() + budgetMs;
  const results = new Array<Loaded | undefined>(entries.length);
  let next = 0;
  let total = 0;

  const worker = async () => {
    while (next < entries.length) {
      const position = next++;
      const remaining = deadline - Date.now();
      if (remaining <= 0 || total >= maxTotal) return;
      const result = await fetchImage(entries[position].url, remaining).catch(() => undefined);
      if (result?.ok && total + result.bytes.length <= maxTotal) {
        total += result.bytes.length;
        results[position] = { index: entries[position].index, bytes: result.bytes };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? VISION_LIMITS.concurrency, entries.length) }, worker));

  const loaded = results.filter((item): item is Loaded => Boolean(item)).sort((a, b) => a.index - b.index);
  return { loaded, skipped: entries.length - loaded.length };
}

/** Cuts every downloaded image into readable tiles. An image that cannot be decoded is dropped, not fatal. */
export async function tileLoaded(loaded: Loaded[], concurrency = 4): Promise<{ tiles: Tile[]; undecodable: number }> {
  const perImage = new Array<Tile[] | undefined>(loaded.length);
  let next = 0;
  const worker = async () => {
    while (next < loaded.length) {
      const position = next++;
      perImage[position] = await tileImage(loaded[position].bytes, loaded[position].index).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, loaded.length) }, worker));
  const tiles = perImage.flatMap((item) => item ?? []);
  return { tiles, undecodable: perImage.filter((item) => !item).length };
}

const asInput = (tile: Tile): ImageInput => ({ mimeType: "image/jpeg", data: tile.bytes.toString("base64") });
const byPosition = (a: Tile, b: Tile) => a.imageIndex - b.imageIndex || a.tileIndex - b.tileIndex;

/** The tiles that go on the contact sheets: the ones that look most like a table or a notice, in page order. */
export function pickSheetCells(tiles: Tile[], max: number = VISION_LIMITS.maxSheetCells): Tile[] {
  return [...tiles]
    .sort((a, b) => b.score - a.score || byPosition(a, b))
    .slice(0, max)
    .sort(byPosition);
}

/** Tiles for the detailed read: what the scan chose first (blend, then size, then care), then the clearest tables. */
export function orderDetailTiles(
  tiles: Tile[],
  candidates: Candidates,
  want: VisionField[],
  options: { heuristic?: boolean; limit?: number; exclude?: Tile[] } = {},
): Tile[] {
  const limit = options.limit ?? VISION_LIMITS.batchSize * VISION_LIMITS.maxBatches;
  const byLabel = new Map(tiles.map((tile) => [tile.label, tile]));
  const labels = [
    ...(want.includes("materials") ? candidates.materials : []),
    ...(want.includes("sizes") ? candidates.sizes : []),
    ...(want.includes("care") ? candidates.care : []),
  ];
  const chosen = [...new Set(labels)].flatMap((label) => byLabel.get(label) ?? []).filter((tile) => !options.exclude?.includes(tile));
  // After a scan, only the clearest tables are added to what the model chose. Without one, looks are all there is.
  const threshold = options.heuristic ? VISION_LIMITS.heuristicScore : VISION_LIMITS.infoScore;
  const extras = options.heuristic ? limit : 2;
  const clear = [...tiles].filter((tile) => tile.score >= threshold && !chosen.includes(tile) && !options.exclude?.includes(tile)).sort((a, b) => b.score - a.score || byPosition(a, b)).slice(0, extras);
  return [...chosen, ...clear].slice(0, limit);
}

export function batchTiles(tiles: Tile[], size: number = VISION_LIMITS.batchSize): Tile[][] {
  const batches: Tile[][] = [];
  for (let start = 0; start < tiles.length; start += size) batches.push(tiles.slice(start, start + size));
  return batches;
}

export type VisionRun = { product: ProductFacts; warnings: string[]; stage?: StageRecord };

type VisionMeta = NonNullable<NonNullable<ProductFacts["extractionMetadata"]>["vision"]>;

/**
 * Last resort for blend and size: read the detail-page images. It runs only when the text stages left the blend or the size
 * empty (care alone never starts it), asks only about what is missing, and only ever fills those fields.
 *
 *   download → cut into tiles → (many tiles) contact sheets → model picks candidates → read candidates closely
 *
 * A page with few images skips the picking step and reads them directly.
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
  const needMaterials = product.materials.length === 0;
  const needSizes = product.sizes.length === 0;
  // Nothing the image stage exists for is missing: exactly the fast path.
  if (!needMaterials && !needSizes) return { product, warnings: [] };

  // Care is a bonus when the images are being read anyway; it never starts the stage on its own.
  const want: VisionField[] = [...(needMaterials ? (["materials"] as const) : []), ...(needSizes ? (["sizes"] as const) : []), ...(!product.careInstructions?.length ? (["care"] as const) : [])];

  const record = (vision: VisionMeta): ProductFacts => ({ ...product, extractionMetadata: { ...product.extractionMetadata!, vision } });
  const skipped = (reason: string, warning?: string): VisionRun => ({
    product: record({ status: "skipped", fields: [], imagesRead: 0, imagesSkipped: 0, reason }),
    warnings: warning ? [warning] : [],
  });

  if (!provider.isAvailable() || !provider.extractFromImages) return skipped("vision_unavailable");
  if (args.imageUrls.length === 0) return skipped("no_detail_images");
  if (args.remainingMs < VISION_LIMITS.minBudgetMs) return skipped("no_time", "시간이 부족해 상세 이미지 분석은 건너뛰었어요.");

  const startedAt = Date.now();
  const totalMs = Math.min(VISION_LIMITS.maxTotalMs, args.remainingMs - 1_500);
  const timeLeft = () => startedAt + totalMs - Date.now();
  const durations: NonNullable<VisionMeta["durationsMs"]> = { fetch: 0, total: 0 };
  const finish = (meta: Omit<VisionMeta, "durationsMs">, extra: Partial<VisionRun> & { product?: ProductFacts } = {}): VisionRun => {
    durations.total = Date.now() - startedAt;
    return { product: extra.product ?? record({ ...meta, durationsMs: durations }), warnings: extra.warnings ?? [], stage: extra.stage };
  };
  const withMeta = (base: ProductFacts, meta: Omit<VisionMeta, "durationsMs">): ProductFacts => {
    durations.total = Date.now() - startedAt;
    return { ...base, extractionMetadata: { ...base.extractionMetadata!, vision: { ...meta, durationsMs: durations } } };
  };

  // 1. Download and cut.
  const entries = prioritizeImages(args.imageUrls);
  const fetchStarted = Date.now();
  const { loaded } = await loadDetailImages(entries, args.fetchImage, { budgetMs: Math.min(VISION_LIMITS.fetchBudgetMs, totalMs * 0.3) });
  const { tiles } = await tileLoaded(loaded);
  durations.fetch = Date.now() - fetchStarted;
  const imagesSkipped = args.imageUrls.length - loaded.length;

  const base: Omit<VisionMeta, "durationsMs" | "status"> = { fields: [], imagesRead: loaded.length, imagesSkipped, tiles: tiles.length };
  if (tiles.length === 0) {
    return finish({ ...base, status: "failed", reason: "images_unreadable" }, { warnings: ["상세 이미지를 불러오지 못해 이미지 속 정보는 반영하지 못했어요."] });
  }

  // 2. Read the best-looking tiles at once, and while that runs let the model choose candidates from contact sheets. Image
  //    calls vary a lot in latency, so the two are not done one after the other.
  const readBatch = (batch: Tile[]) => {
    const budgetMs = Math.min(VISION_LIMITS.detailMaxMs, timeLeft());
    return provider.extractFromImages!({ url: args.pageUrl, images: batch.map(asInput), labels: batch.map((tile) => tile.label), want, budgetMs });
  };
  const emptyCandidates: Candidates = { materials: [], sizes: [], care: [] };

  let candidates: Candidates = emptyCandidates;
  let mode: NonNullable<VisionMeta["mode"]> = "direct";
  const rounds: Array<Promise<ImageExtractionResult>> = [];
  // A read that fails while the scan is still running must not be reported as unhandled; its outcome is collected below.
  const start = (batch: Tile[]) => {
    const read = readBatch(batch);
    read.catch(() => undefined);
    rounds.push(read);
  };
  const detailStarted = Date.now();

  if (tiles.length <= VISION_LIMITS.directReadMaxTiles) {
    batchTiles(tiles).slice(0, VISION_LIMITS.maxBatches).forEach(start);
  } else if (loaded.length <= VISION_LIMITS.fewImages) {
    // Few images, many tiles (each is long): there is nothing to choose between, and a size table or a composition line can sit
    // in any tile. Read them all, best-looking first, side by side.
    mode = "heuristic";
    const ordered = [...tiles].sort((a, b) => b.score - a.score || byPosition(a, b)).slice(0, VISION_LIMITS.fewImagesMaxTiles);
    batchTiles(ordered).forEach(start);
  } else {
    const first = orderDetailTiles(tiles, emptyCandidates, want, { heuristic: true, limit: VISION_LIMITS.batchSize });
    if (first.length > 0) start(first);

      const scan = provider.scanDetailImages ? await scanForCandidates() : undefined;
    mode = scan ? "scan" : "heuristic";
    candidates = scan ?? emptyCandidates;

    const second = orderDetailTiles(tiles, candidates, want, { heuristic: !scan, limit: VISION_LIMITS.batchSize, exclude: first });
    if (second.length > 0 && timeLeft() >= VISION_LIMITS.minDetailMs) start(second);
  }

  async function scanForCandidates(): Promise<Candidates | undefined> {
    const scanStarted = Date.now();
    try {
      const scanBudget = Math.min(VISION_LIMITS.scanBudgetMs, timeLeft() - VISION_LIMITS.minDetailMs);
      if (scanBudget < 4_000) return undefined;
      const cells = pickSheetCells(tiles);
      const groups = Array.from({ length: Math.ceil(cells.length / SHEET.cellsPerSheet) }, (_, index) => cells.slice(index * SHEET.cellsPerSheet, (index + 1) * SHEET.cellsPerSheet));
      const sheets = await Promise.all(groups.map((group) => buildContactSheet(group.map((tile) => ({ label: tile.label, thumb: tile.thumb })))));
      const result = await provider.scanDetailImages!({
        sheets: sheets.map((sheet) => ({ mimeType: "image/jpeg", data: sheet.toString("base64") })),
        sheetLabels: groups.map((group) => group.map((tile) => tile.label)),
        columns: SHEET.columns,
        want,
        budgetMs: scanBudget,
      });
      return result.candidates;
    } catch {
      // The pick failed or ran out of time: the tiles that look most like a table are read instead.
      return undefined;
    } finally {
      durations.scan = Date.now() - scanStarted;
    }
  }

  const meta = { ...base, mode, candidates };
  if (rounds.length === 0) {
    return finish({ ...meta, status: "no_result", reason: "no_candidates" }, { product: withMeta(product, { ...meta, status: "no_result", reason: "no_candidates" }) });
  }

  // 3. Whatever has come back is used; one failed read does not spoil the other.
  const settled = await Promise.allSettled(rounds);
  durations.detail = Date.now() - detailStarted;

  const results = settled.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
  if (results.length === 0) {
    const failure = settled.find((item) => item.status === "rejected") as PromiseRejectedResult | undefined;
    const reason = failure?.reason instanceof ExtractionProviderError ? failure.reason.code : "upstream";
    return finish({ ...meta, status: "failed", reason }, { product: withMeta(product, { ...meta, status: "failed", reason }), warnings: ["상세 이미지 분석에 문제가 있어 이미지 속 정보는 반영하지 못했어요."] });
  }

  // 4. Merge: fill only what was empty, first reading wins.
  const materials: MaterialBlend[] = results.find((result) => result.materials.length > 0)?.materials ?? [];
  const sizes: ProductSize[] = [];
  for (const row of results.flatMap((result) => result.sizes)) if (!sizes.some((existing) => existing.name === row.name)) sizes.push(row);
  const care = [...new Set(results.flatMap((result) => result.careInstructions))].slice(0, 8);
  const reported: VisionEvidence[] = results.flatMap((result) => result.evidence).filter((item, position, all) => all.findIndex((other) => other.field === item.field && other.imageIndex === item.imageIndex && other.tileIndex === item.tileIndex) === position);
  const model = results[0].model;
  // The model did not say which image it read a field from: fall back on what the scan had pointed it at, marked low.
  const inferred: VisionEvidence[] = (["materials", "sizes", "care"] as const).flatMap((field) =>
    reported.some((item) => item.field === field)
      ? []
      : candidates[field === "care" ? "care" : field].flatMap((label) => {
          const found = tiles.find((tile) => tile.label === label);
          return found ? [{ field, imageIndex: found.imageIndex, tileIndex: found.tileCount > 1 ? found.tileIndex : undefined, confidence: "low" as const }] : [];
        }),
  );
  const evidence: VisionEvidence[] = [...reported, ...inferred];

  const filled: Array<"materials" | "sizes" | "care"> = [];
  const next: ProductFacts = { ...product };
  if (needMaterials && materials.length > 0) {
    next.materials = materials;
    filled.push("materials");
  }
  if (needSizes && sizes.length > 0) {
    next.sizes = sizes;
    filled.push("sizes");
  }
  if (want.includes("care") && care.length > 0) {
    next.careInstructions = care;
    filled.push("care");
  }

  const warnings = [...new Set(results.flatMap((result) => result.warnings))];
  if (filled.length === 0) {
    return finish({ ...meta, status: "no_result", reason: "nothing_readable", model }, { product: withMeta(next, { ...meta, status: "no_result", reason: "nothing_readable", model }), warnings });
  }

  const labels = { materials: "소재", sizes: "사이즈", care: "관리법" } as const;
  const names = filled.map((field) => labels[field]).join("·");
  const lastChar = names.charCodeAt(names.length - 1);
  const topic = (lastChar - 0xac00) % 28 !== 0 ? "은" : "는";
  const used = withMeta({ ...next, extractionMetadata: { ...next.extractionMetadata!, strategy: [...next.extractionMetadata!.strategy, "image-vision"] } }, {
    ...meta,
    status: "used",
    fields: filled,
    evidence: evidence.filter((item) => filled.includes(item.field)),
    model,
  });
  return {
    product: used,
    warnings: [...warnings, `${names}${topic} 상세 이미지에서 AI가 읽은 값이라 참고용이에요.`],
    stage: { source: "product-detail-image-vision", fields: filled as DetailField[] },
  };
}
