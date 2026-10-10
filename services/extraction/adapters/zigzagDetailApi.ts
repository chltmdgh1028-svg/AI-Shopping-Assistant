import type { ProductSize } from "@/types/shopping";

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

type Measure = "shoulder" | "chest" | "waist" | "hip" | "length" | "sleeve";

// Header names of the size table → the measurement they hold. Sleeve is tested before length: "소매길이" contains "길이".
const columns: Array<[Measure, RegExp]> = [
  ["sleeve", /소매/],
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

// The widest a laid-flat width can plausibly be. A bigger number under a "단면" header is a circumference that the seller
// put in the wrong column (doubling it would give a 250cm chest), so it is used as written.
const widestFlat: Partial<Record<Measure, number>> = { chest: 85, waist: 75, hip: 90 };

/**
 * One table of "value_list" rows: a header row, then one row per size. A header that says "단면" is a laid-flat width, so
 * chest, waist and hip are doubled to a circumference; the shoulder is already a straight width. Cells that are not a
 * plain number ("-", "49~50") are left out rather than guessed.
 */
export function parseSizeTable(valueList: unknown, note = ""): { sizes: ProductSize[]; warnings: string[] } {
  const warnings: string[] = [];
  if (!Array.isArray(valueList) || valueList.length < 2) return { sizes: [], warnings };

  const rows = valueList.filter((row): row is unknown[] => Array.isArray(row)).map((row) => row.map((cell) => (typeof cell === "string" || typeof cell === "number" ? String(cell) : "")));
  const header = rows[0];
  const nameColumn = header.findIndex((cell) => /사이즈|size/i.test(cell));
  if (nameColumn === -1) return { sizes: [], warnings };

  const indexFor = new Map<Measure, { index: number; flat: boolean }>();
  header.forEach((cell, index) => {
    const found = columns.find(([, pattern]) => pattern.test(cell));
    if (found && !indexFor.has(found[0])) indexFor.set(found[0], { index, flat: /단면/.test(cell) });
  });

  const factor = /inch|인치/i.test(note) ? 2.54 : 1;
  const sizes: ProductSize[] = [];
  let doubled = false;
  let mislabelled = false;

  for (const row of rows.slice(1, 21)) {
    const name = normalizeSizeName(row[nameColumn] ?? "");
    if (!name || name.length > 12) continue;

    const values: Partial<Record<Measure, number>> = {};
    for (const [measure, { index, flat }] of indexFor) {
      const cell = row[index];
      if (cell === undefined || !isNumber(cell)) continue;
      const base = Number(cell.replace(/cm/i, "").trim()) * factor;
      const flatLimit = widestFlat[measure];
      const looksFlat = flat && flatLimit !== undefined && base <= flatLimit;
      const wide = looksFlat;
      if (flat && flatLimit !== undefined && !looksFlat) mislabelled = true;
      if (wide) doubled = true;
      values[measure] = Math.round((wide ? base * 2 : base) * 10) / 10;
    }
    if (Object.keys(values).length === 0) continue;

    sizes.push({ name, ...values, unit: "cm", source: "structured-data", confidence: "high" });
  }

  if (doubled) warnings.push("사이즈표의 단면 치수를 둘레로 환산했어요.");
  if (mislabelled) warnings.push("단면이라고 적혀 있지만 값이 커서 둘레 치수로 보고 그대로 사용했어요.");
  if (factor !== 1) warnings.push("인치 단위 사이즈표를 cm로 환산했어요.");
  return { sizes, warnings };
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
