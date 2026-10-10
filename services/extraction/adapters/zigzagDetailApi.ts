import { interpretWidth, isWidthMeasure, type Measure, type WidthLabel } from "@/domain/sizeMeasurements";
import type { ExtractionConfidence, ProductSize } from "@/types/shopping";

// The size tab of a Zigzag product page is not in the page's HTML. The site's own front end loads it with one GraphQL
// call to its public API, and that call is repeated here (no browser, no click). Only api.zigzag.kr is ever called.
const API_HOST = "api.zigzag.kr";
const DEFAULT_API_BASE = "https://api.zigzag.kr/api/2";

export const SIZE_INFO_QUERY =
  "query GetSizeInfo($catalog_product_id: ID!) { pdp_size_info(catalog_product_id: $catalog_product_id) { item_list { image_url value_list description size_category_id } has_size_tab_content } }";

export type JsonPoster = (url: string, body: unknown) => Promise<{ ok: true; data: unknown } | { ok: false }>;

/** The API address comes from the page's own runtime config, but is only trusted when it is Zigzag's API host. */
export function sizeInfoRequest(apiBase: string | undefined, productId: string): { url: string; body: unknown } {
  let base = DEFAULT_API_BASE;
  try {
    const candidate = new URL(apiBase ?? DEFAULT_API_BASE);
    if (candidate.protocol === "https:" && candidate.hostname === API_HOST) base = candidate.origin + candidate.pathname.replace(/\/$/, "");
  } catch {
    // keep the default
  }
  return {
    url: `${base}/graphql/GetSizeInfo`,
    body: { query: SIZE_INFO_QUERY, variables: { catalog_product_id: productId } },
  };
}

// Header names of the size table → the measurement they hold. Order matters: "소매길이" (sleeve length) must not be read as
// the garment length, and "소매단면" (a sleeve width) matches nothing because no fit decision uses it.
const columns: Array<[Measure, RegExp]> = [
  ["sleeve", /소매\s*(?:길이|총\s*장|장)|^\s*소매\s*$/],
  ["armhole", /암홀/],
  ["rise", /밑위/],
  ["thigh", /허벅지/],
  ["hem", /밑단|햄/],
  ["length", /총\s*기장|총\s*장|기장|길이/],
  ["shoulder", /어깨/],
  ["chest", /가슴/],
  ["waist", /허리/],
  ["hip", /엉덩이|힙/],
];

const isNumber = (cell: string) => /^\s*\d+(?:\.\d+)?\s*(?:cm)?\s*$/i.test(cell);

function normalizeSizeName(raw: string) {
  const name = raw.trim().toUpperCase().replace(/\s+/g, " ");
  // "원사이즈/FREE", "F/F", "ONE SIZE", "프리": one size that fits all.
  return /^(F|F\/F|FREE.*|.*\/\s*FREE|ONE ?SIZE|원사이즈.*|프리.*|단일.*)$/i.test(name) ? "FREE" : name;
}

const labelOf = (header: string): WidthLabel => (/단면/.test(header) ? "flat" : /둘레/.test(header) ? "circumference" : "unknown");

const confidenceRank: Record<ExtractionConfidence, number> = { low: 0, medium: 1, high: 2 };

/**
 * One table of "value_list" rows: a header row, then one row per size. Works for tops, trousers, skirts and dresses alike:
 * the columns decide which measurements exist. A width the header calls "단면" (laid flat) is doubled only if it is small
 * enough to be one; a number that is too large to be a flat width is a circumference in the wrong column and is used as
 * written (see interpretWidth). Cells that are not a plain number ("-", "49~50") are left out rather than guessed.
 */
export function parseSizeTable(valueList: unknown, note = ""): { sizes: ProductSize[]; warnings: string[] } {
  const warnings = new Set<string>();
  if (!Array.isArray(valueList) || valueList.length < 2) return { sizes: [], warnings: [] };

  const rows = valueList.filter((row): row is unknown[] => Array.isArray(row)).map((row) => row.map((cell) => (typeof cell === "string" || typeof cell === "number" ? String(cell) : "")));
  const header = rows[0];
  const nameColumn = header.findIndex((cell) => /사이즈|size/i.test(cell));
  if (nameColumn === -1) return { sizes: [], warnings: [] };

  const indexFor = new Map<Measure, { index: number; label: WidthLabel }>();
  header.forEach((cell, index) => {
    const found = columns.find(([, pattern]) => pattern.test(cell));
    if (found && !indexFor.has(found[0])) indexFor.set(found[0], { index, label: labelOf(cell) });
  });

  const factor = /inch|인치/i.test(note) ? 2.54 : 1;
  // A table with a chest or a shoulder column describes a top, a dress or an outer: its hem is as wide as the body.
  const bodyHem = indexFor.has("chest") || indexFor.has("shoulder");
  const sizes: ProductSize[] = [];

  for (const row of rows.slice(1, 21)) {
    const name = normalizeSizeName(row[nameColumn] ?? "");
    if (!name || name.length > 12) continue;

    const values: Partial<Record<Measure, number>> = {};
    let confidence: ExtractionConfidence = "high";
    for (const [measure, { index, label }] of indexFor) {
      const cell = row[index];
      if (cell === undefined || !isNumber(cell)) continue;
      const printed = Number(cell.replace(/cm/i, "").trim()) * factor;

      if (isWidthMeasure(measure)) {
        const reading = interpretWidth(measure, Math.round(printed * 10) / 10, label, { bodyHem });
        values[measure] = reading.value;
        if (reading.converted) warnings.add("사이즈표의 단면 치수를 둘레로 환산했어요.");
        if (reading.note && !reading.converted) warnings.add(reading.note);
        if (confidenceRank[reading.confidence] < confidenceRank[confidence]) confidence = reading.confidence;
      } else {
        values[measure] = Math.round(printed * 10) / 10;
      }
    }
    if (Object.keys(values).length === 0) continue;

    sizes.push({ name, ...values, unit: "cm", source: "structured-data", confidence });
  }

  if (factor !== 1) warnings.add("인치 단위 사이즈표를 cm로 환산했어요.");
  return { sizes, warnings: [...warnings] };
}

/** The size table for a product, from the site's own API. undefined when the tab holds no table. */
export async function fetchZigzagSizes(
  productId: string,
  apiBase: string | undefined,
  post: JsonPoster,
): Promise<{ sizes: ProductSize[]; warnings: string[] } | undefined> {
  if (!/^\d{1,20}$/.test(productId)) return undefined;
  const request = sizeInfoRequest(apiBase, productId);
  const response = await post(request.url, request.body);
  if (!response.ok) return undefined;

  const items = (response.data as { data?: { pdp_size_info?: { item_list?: unknown } } } | null)?.data?.pdp_size_info?.item_list;
  if (!Array.isArray(items)) return undefined;

  for (const item of items) {
    const table = (item as { value_list?: unknown; description?: unknown } | null) ?? {};
    const note = Array.isArray(table.description) ? table.description.filter((line) => typeof line === "string").join(" ") : "";
    const parsed = parseSizeTable(table.value_list, note);
    if (parsed.sizes.length > 0) return parsed;
  }
  return undefined;
}
