import { looksLikeCareInstruction } from "@/domain/careSignals";
import { readMaterialShares } from "@/domain/materialParsing";
import { buildPricing, formatPriceLabel } from "@/domain/pricing";
import { categorize, extractFit, extractSizes } from "@/services/extraction/htmlExtraction";
import type { AdapterEnrichment, ProductAdapterResult } from "@/services/extraction/adapters/types";
import { fetchZigzagSizes, type JsonPoster } from "@/services/extraction/adapters/zigzagDetailApi";
import type { DetailField, ProductSize } from "@/types/shopping";

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const amount = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);
const at = (value: unknown, ...path: string[]): unknown => path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), value);

const MAX_NEXT_DATA_CHARS = 1_000_000;
const MAX_DETAIL_CHARS = 6000;

function readNextData(html: string): Json | undefined {
  const raw = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw || raw.length > MAX_NEXT_DATA_CHARS) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/** The seller's detail description is HTML. Block ends become line breaks so "SIZE" and its numbers stay on separate lines. */
function htmlToLines(html: string) {
  return decodeEntities(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

const imageAttributes = ["ec-data-src", "data-src", "data-original", "src"];
// Icons, spacers and animated GIFs never carry a size table.
const notADetailImage = /\.(?:svg|gif)(?:[?#]|$)|icon|logo|sprite|spacer|pixel|blank|badge|btn_|button/i;

function attribute(tag: string, name: string) {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, "i"))?.[1];
}

/** The seller's detail page is mostly images; sizes and fabric are often printed on them. Only https images are kept. */
function collectDetailImages(html: string) {
  const urls: string[] = [];
  for (const tag of html.matchAll(/<img\b[^>]*>/gi)) {
    const raw = imageAttributes.map((name) => attribute(tag[0], name)).find(Boolean);
    if (!raw) continue;
    const url = decodeEntities(raw.trim()).replace(/^\/\//, "https://");
    if (!/^https:\/\//i.test(url) || notADetailImage.test(url) || urls.includes(url)) continue;
    urls.push(url);
  }
  return urls.slice(0, 60);
}

const number = "(\\d+(?:\\.\\d+)?)";

/**
 * Many sellers print one size as a line of measurements: "SIZE / 어깨34 가슴43.5 암홀20 / 소매총장56 총장49".
 * Without a size label the garment is a single (free) size.
 */
function readFlatSize(lines: string): { size: ProductSize; flat: boolean } | undefined {
  const segment = lines.match(/\bSIZE\b[^\n]*(?:\n[^\n]*){0,3}/i)?.[0];
  if (!segment) return undefined;

  const pick = (pattern: RegExp) => {
    const value = segment.match(pattern)?.[1];
    return value ? Number(value) : undefined;
  };
  const chest = pick(new RegExp(`가슴(?:단면)?\\s*${number}`));
  if (chest === undefined) return undefined;

  // Sellers list the width of the laid-flat garment. No adult chest is under 70cm round, so that is a half measure.
  const flat = chest < 70;
  return {
    flat,
    size: {
      name: "FREE",
      shoulder: pick(new RegExp(`어깨\\s*${number}`)),
      chest: flat ? chest * 2 : chest,
      length: pick(new RegExp(`(?<!소매)총장\\s*${number}`)),
      sleeve: pick(new RegExp(`소매(?:총장|길이)?\\s*${number}`)),
      unit: "cm",
      source: "structured-data",
      confidence: "medium",
    },
  };
}

function readCareLines(lines: string) {
  return lines
    .split("\n")
    .filter((line) => looksLikeCareInstruction(line))
    .slice(0, 8);
}

async function enrichSizes(productId: string, apiBase: string | undefined, post: JsonPoster): Promise<AdapterEnrichment | undefined> {
  const found = await fetchZigzagSizes(productId, apiBase, post);
  if (!found) return undefined;
  return { product: { sizes: found.sizes }, warnings: found.warnings, stage: { source: "zigzag-detail-api", fields: ["sizes"] } };
}

type Notice = { name: string; value: string };

// "상세정보 참고", "상품상세참조", "해당없음": the field exists but says to look elsewhere, so it carries no fact.
const pointsElsewhere = /상세|참조|참고|해당\s*없음|^-+$/;

/**
 * The collapsed "상품정보 제공고시" list (and the older product_info_map) is already part of the page's data, so it is read
 * without clicking anything. Entries that only point to the detail page are dropped.
 */
function readNotices(product: Json): Notice[] {
  const notices: Notice[] = [];
  const add = (name: unknown, value: unknown) => {
    const label = text(name);
    const body = typeof value === "string" ? htmlToLines(value).replace(/\n/g, " ").trim() : typeof value === "number" ? String(value) : "";
    if (!label || !body || body.length > 300) return;
    if (body.length <= 20 && pointsElsewhere.test(body)) return;
    notices.push({ name: label, value: body });
  };

  for (const entry of Array.isArray(product.essentials) ? product.essentials : []) add(at(entry, "name"), at(entry, "value"));

  const map = product.product_info_map;
  if (Array.isArray(map)) for (const entry of map) add(at(entry, "name") ?? at(entry, "title") ?? at(entry, "key"), at(entry, "value"));
  else if (isRecord(map)) for (const [name, value] of Object.entries(map)) add(name, value);

  return notices;
}

const noticeFor = (notices: Notice[], pattern: RegExp) => notices.filter((notice) => pattern.test(notice.name));

/**
 * Zigzag product pages ship the product as JSON inside the HTML (Next.js __NEXT_DATA__): price, images and the seller's
 * full description, none of which is visible text. This reads that data directly, so no browser rendering is needed.
 */
export function extractZigzagProduct(html: string): ProductAdapterResult | undefined {
  const nextData = readNextData(html);
  const queries = at(nextData, "props", "pageProps", "dehydratedState", "queries");
  if (!Array.isArray(queries)) return undefined;

  const query = queries.find((item) => Array.isArray(at(item, "queryKey")) && (at(item, "queryKey") as unknown[])[0] === "getPdpBaseInfo");
  const data = at(query, "state", "data");
  const product = at(data, "product");
  if (!isRecord(product)) return undefined;

  const name = text(product.name);
  if (!name) return undefined;

  const brand = text(at(data, "shop", "name"));
  const price = at(product, "product_price");
  const currentPrice = amount(at(price, "display_final_price", "final_price", "price")) ?? amount(at(price, "store_discount_info", "discount_price"));
  const listPrice = amount(at(price, "max_price_info", "price"));
  // A coupon price needs the buyer to hold the coupon, so it is mentioned and never used as the price.
  const couponPrice = amount(at(price, "final_discount_info", "discount_price"));
  const note =
    currentPrice !== undefined && couponPrice !== undefined && couponPrice < currentPrice
      ? `쿠폰을 적용하면 ${formatPriceLabel(couponPrice, "KRW")}까지 내려가요. 쿠폰 조건은 지그재그에서 확인하세요.`
      : undefined;
  const pricing = buildPricing({ currentPrice, originalPrice: listPrice, currency: "KRW", source: "structured-data", confidence: "high", note });

  const images = (Array.isArray(product.product_image_list) ? product.product_image_list : [])
    .flatMap((image) => [text(at(image, "pdp_static_image_url")) ?? text(at(image, "pdp_thumbnail_url")) ?? text(at(image, "url"))])
    .filter((url): url is string => Boolean(url) && /^https:\/\//.test(url as string));

  const categories = (Array.isArray(product.category_list) ? product.category_list : []).map((item) => text(at(item, "value")) ?? "").join(" ");
  const detail = htmlToLines(typeof product.description === "string" ? product.description : "").slice(0, MAX_DETAIL_CHARS);

  const notices = readNotices(product);
  const noticeText = notices.map((notice) => `${notice.name}: ${notice.value}`).join("\n");
  // The notice list is a labelled field ("제품소재"), so it is preferred; the seller's free text fills in when it is silent.
  const noticeMaterials = noticeFor(notices, /소재|재질|혼용|fabric|material/i).flatMap((notice) => readMaterialShares(notice.value, "structured-data", "medium"));
  const materials = noticeMaterials.length > 0 ? noticeMaterials : readMaterialShares(detail, "structured-data", "medium");
  const noticeSizeText = noticeFor(notices, /치수|사이즈|size/i).map((notice) => notice.value).join("\n");
  const sizeText = [detail, noticeSizeText].filter(Boolean).join("\n");
  const tableSizes = extractSizes(sizeText);
  const flatSize = tableSizes.length === 0 ? readFlatSize(sizeText) : undefined;
  const sizes = tableSizes.length > 0 ? tableSizes : flatSize ? [flatSize.size] : [];
  const noticeCare = noticeFor(notices, /세탁|취급|관리|care/i).flatMap((notice) => notice.value.split(/[,;·/\n]+/).map((part) => part.trim()));
  const care = [...new Set([...readCareLines(detail), ...noticeCare.filter((line) => looksLikeCareInstruction(line))])].slice(0, 8);

  const warnings: string[] = [];
  if (flatSize?.flat) warnings.push(`가슴 치수 ${(flatSize.size.chest ?? 0) / 2}cm는 단면 기준으로 보고 둘레 ${flatSize.size.chest}cm로 환산했어요.`);

  const productId = text(product.id) ?? (typeof product.id === "number" ? String(product.id) : undefined);
  const apiBase = text(at(nextData, "runtimeConfig", "config", "apiConsumerBaseUrl"));
  const foundFields: DetailField[] = [
    ...(pricing ? (["price"] as const) : []),
    ...(images.length ? (["images"] as const) : []),
    ...(materials.length ? (["materials"] as const) : []),
    ...(sizes.length ? (["sizes"] as const) : []),
    ...(care.length ? (["care"] as const) : []),
  ];

  const summary = [
    `상품명: ${name}`,
    brand ? `판매처: ${brand}` : undefined,
    pricing ? `판매가: ${formatPriceLabel(pricing.currentPrice, pricing.currency)}${pricing.originalPrice ? ` (정가 ${formatPriceLabel(pricing.originalPrice, pricing.currency)})` : ""}` : undefined,
    noticeText ? `상품정보 제공고시:\n${noticeText}` : undefined,
    detail ? `상세 설명:\n${detail}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    adapter: "zigzag",
    text: summary,
    warnings,
    detailImageUrls: collectDetailImages(typeof product.description === "string" ? product.description : ""),
    stage: { source: "zigzag-next-data", fields: foundFields },
    // The size tab loads on click, from the site's own API. Only asked for when the page data held no size.
    enrich: sizes.length > 0 || !productId ? undefined : (post) => enrichSizes(productId, apiBase, post),
    product: {
      productName: name,
      brand,
      category: categorize(`${categories} ${name}`),
      price: pricing ? formatPriceLabel(pricing.currentPrice, pricing.currency) : undefined,
      currency: pricing?.currency,
      pricing,
      images,
      description: detail.replace(/\n/g, " ").slice(0, 800),
      materials,
      sizes,
      fit: extractFit(detail),
      careInstructions: care,
    },
  };
}
