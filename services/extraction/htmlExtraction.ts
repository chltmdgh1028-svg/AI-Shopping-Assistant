import { categorizeProduct } from "@/domain/garment";
import { readMaterialShares } from "@/domain/materialParsing";
import { formatPrice } from "@/domain/pricing";
import { extractPricing } from "@/services/extraction/priceExtraction";
import type { FitPreference, ProductFacts, ProductSize } from "@/types/shopping";

type JsonRecord = Record<string, unknown>;

export function extractProductFromHtml(html: string, sourceUrl: string): ProductFacts {
  const jsonLdProduct = extractJsonLdProducts(html)[0];
  const meta = extractMetaTags(html);
  const pageText = extractVisibleText(html);
  const structured = jsonLdProduct ? mapJsonLdProduct(jsonLdProduct, sourceUrl) : undefined;
  const pageDerived = extractFromPageText(pageText, sourceUrl);
  const pricing = extractPricing({ jsonLdProduct, meta, html, pageText });

  const product: ProductFacts = {
    productName:
      structured?.productName ||
      meta["og:title"] ||
      meta["twitter:title"] ||
      extractTitle(html) ||
      pageDerived.productName,
    brand: structured?.brand || pageDerived.brand,
    category: structured?.category || pageDerived.category || "unknown",
    price: pricing ? formatPrice(pricing.currentPrice, pricing.currency) : undefined,
    currency: pricing?.currency,
    pricing,
    images: unique([...(structured?.images ?? []), meta["og:image"], meta["twitter:image"]].filter(Boolean) as string[]),
    description: structured?.description || meta["description"] || meta["og:description"] || pageDerived.description,
    materials: structured?.materials?.length ? structured.materials : pageDerived.materials,
    sizes: structured?.sizes?.length ? structured.sizes : pageDerived.sizes,
    fit: pageDerived.fit,
    careInstructions: pageDerived.careInstructions,
    sourceUrl,
    factsSource: "product_page",
    extractionMetadata: {
      strategy: [
        ...(jsonLdProduct ? ["json-ld" as const] : []),
        ...(Object.keys(meta).length ? ["meta" as const] : []),
        "page-text",
      ],
      status: pageDerived.materials.length || structured?.productName ? "partial" : "failed",
      confidence: jsonLdProduct ? "medium" : "low",
      aiProvider: "unavailable",
      warnings: buildWarnings(structured, pageDerived, Boolean(pricing)),
      fetchedAt: new Date().toISOString(),
    },
  };

  return product;
}

export function extractJsonLdProducts(html: string): JsonRecord[] {
  const scripts = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  return Array.from(scripts).flatMap((match) => {
    const text = decodeHtml(stripTags(match[1])).trim();
    try {
      const parsed = JSON.parse(text) as unknown;
      return findProductNodes(parsed);
    } catch {
      return [];
    }
  });
}

export function extractMetaTags(html: string) {
  const tags = html.matchAll(/<meta\s+[^>]*>/gi);
  const result: Record<string, string> = {};
  for (const tag of tags) {
    const raw = tag[0];
    const key = getAttr(raw, "property") || getAttr(raw, "name");
    const content = getAttr(raw, "content");
    if (key && content) result[key.toLowerCase()] = decodeHtml(content);
  }
  return result;
}

export function extractVisibleText(html: string) {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, 20000);
}

function mapJsonLdProduct(node: JsonRecord, sourceUrl: string): Partial<ProductFacts> {
  const brand = firstObject(node.brand);
  const imageValue = node.image;
  const images = Array.isArray(imageValue) ? imageValue.filter(isString) : isString(imageValue) ? [imageValue] : [];

  return {
    productName: stringValue(node.name) || "상품명 미확인",
    brand: stringValue(brand?.name) || stringValue(node.brand),
    category: categorize(`${stringValue(node.category) ?? ""} ${stringValue(node.name) ?? ""}`),
    images,
    description: stringValue(node.description) || "",
    materials: readMaterialShares(`${stringValue(node.material) ?? ""} ${stringValue(node.description) ?? ""}`, "structured-data", "medium"),
    sizes: [],
    sourceUrl,
    factsSource: "product_page",
  };
}

function extractFromPageText(text: string, sourceUrl: string): ProductFacts {
  const firstLine = text.split(/[.!?\n]/).find((line) => line.trim().length > 4)?.trim();
  return {
    productName: firstLine?.slice(0, 64) || "상품명 미확인",
    category: categorize(text),
    images: [],
    description: text.slice(0, 800),
    materials: readMaterialShares(text, "page", "low"),
    sizes: extractSizes(text),
    fit: extractFit(text),
    careInstructions: text
      .split(/(?=세탁|건조|드라이|찬물|울코스|Wash|Dry)/i)
      .filter((part) => /세탁|건조|드라이|울코스|wash|dry/i.test(part))
      .map((part) => part.trim().slice(0, 80))
      .slice(0, 5),
    sourceUrl,
    factsSource: "product_page",
  };
}

export function extractSizes(text: string): ProductSize[] {
  const rows = text.matchAll(/(XS|S|M|L|XL|XXL)\s*[:/-]?\s*(?:어깨|shoulder)?\s*(\d{2,3})?.*?(?:가슴|chest|bust)\s*(\d{2,3}).*?(?:허리|waist)?\s*(\d{2,3})?.*?(?:총장|length)\s*(\d{2,3})/gi);
  return Array.from(rows).map((match) => ({
    name: match[1].toUpperCase(),
    shoulder: match[2] ? Number(match[2]) : undefined,
    chest: Number(match[3]),
    waist: match[4] ? Number(match[4]) : undefined,
    length: Number(match[5]),
    unit: "cm",
    source: "page",
    confidence: "low",
  }));
}

export function extractFit(text: string): FitPreference | undefined {
  if (/오버|oversized/i.test(text)) return "oversized";
  if (/여유|relaxed|loose/i.test(text)) return "relaxed";
  if (/슬림|slim/i.test(text)) return "slim";
  if (/정핏|regular|standard/i.test(text)) return "regular";
  return undefined;
}

function extractTitle(html: string) {
  return decodeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
}

export const categorize = categorizeProduct;

function buildWarnings(structured: Partial<ProductFacts> | undefined, pageDerived: ProductFacts, hasPrice: boolean) {
  const warnings: string[] = [];
  if (!structured) warnings.push("JSON-LD Product 구조화 데이터를 찾지 못했습니다.");
  if (pageDerived.materials.length === 0) warnings.push("소재 혼용률을 자동으로 확인하지 못했습니다.");
  if (pageDerived.sizes.length === 0) warnings.push("사이즈표를 자동으로 확인하지 못했습니다.");
  if (!hasPrice) warnings.push("가격을 자동으로 확인하지 못했습니다.");
  return warnings;
}

function findProductNodes(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value.flatMap(findProductNodes);
  if (!isRecord(value)) return [];
  const graph = value["@graph"];
  const type = value["@type"];
  const typeList = Array.isArray(type) ? type : [type];
  const self = typeList.some((item) => String(item).toLowerCase() === "product") ? [value] : [];
  return [...self, ...findProductNodes(graph)];
}

function firstObject(value: unknown): JsonRecord | undefined {
  if (Array.isArray(value)) return value.find(isRecord);
  return isRecord(value) ? value : undefined;
}

function getAttr(tag: string, attr: string) {
  const match = tag.match(new RegExp(`${attr}=["']([^"']+)["']`, "i"));
  return match?.[1];
}

function stripTags(value: string) {
  return value.replace(/<[^>]+>/g, "");
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object";
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}
