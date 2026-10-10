import { readMaterialShares } from "@/domain/materialParsing";
import { buildPricing, formatPriceLabel } from "@/domain/pricing";
import { categorize, extractFit, extractSizes } from "@/services/extraction/htmlExtraction";
import type { ProductAdapterResult } from "@/services/extraction/adapters/types";
import type { ProductSize } from "@/types/shopping";

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

// Only lines that tell the buyer what to do count. "소재별 세탁 가이드 바로가기" is a link to a guide, not an instruction.
const careLine = /손세탁|단독\s*세탁|세탁기|드라이\s*클리닝|건조기|그늘|자연\s*건조|표백|비틀|다림질|울\s*코스|찬물|중성\s*세제/;
function readCareLines(lines: string) {
  return lines
    .split("\n")
    .filter((line) => line.length <= 80 && careLine.test(line) && !/바로가기|가이드|https?:|공지/.test(line))
    .slice(0, 8);
}

/**
 * Zigzag product pages ship the product as JSON inside the HTML (Next.js __NEXT_DATA__): price, images and the seller's
 * full description, none of which is visible text. This reads that data directly, so no browser rendering is needed.
 */
export function extractZigzagProduct(html: string): ProductAdapterResult | undefined {
  const queries = at(readNextData(html), "props", "pageProps", "dehydratedState", "queries");
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

  const materials = readMaterialShares(detail, "structured-data", "medium");
  const tableSizes = extractSizes(detail);
  const flatSize = tableSizes.length === 0 ? readFlatSize(detail) : undefined;
  const sizes = tableSizes.length > 0 ? tableSizes : flatSize ? [flatSize.size] : [];
  const care = readCareLines(detail);

  const warnings: string[] = [];
  if (flatSize?.flat) warnings.push(`가슴 치수 ${(flatSize.size.chest ?? 0) / 2}cm는 단면 기준으로 보고 둘레 ${flatSize.size.chest}cm로 환산했어요.`);

  const summary = [
    `상품명: ${name}`,
    brand ? `판매처: ${brand}` : undefined,
    pricing ? `판매가: ${formatPriceLabel(pricing.currentPrice, pricing.currency)}${pricing.originalPrice ? ` (정가 ${formatPriceLabel(pricing.originalPrice, pricing.currency)})` : ""}` : undefined,
    detail ? `상세 설명:\n${detail}` : undefined,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    adapter: "zigzag",
    text: summary,
    warnings,
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
