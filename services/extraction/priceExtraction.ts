import { buildPricing, detectCurrency, normalizeCurrency, parsePriceAmount } from "@/domain/pricing";
import type { ExtractionSource, ProductPricing } from "@/types/shopping";

type JsonRecord = Record<string, unknown>;

type Candidate = {
  current?: number;
  original?: number;
  currency?: string;
  source: ExtractionSource;
  confidence: "high" | "medium" | "low";
  note?: string;
};

export type PriceSources = {
  /** The first JSON-LD Product node, if any. */
  jsonLdProduct?: JsonRecord;
  /** Lower-cased meta property/name -> content. */
  meta: Record<string, string>;
  /** Raw HTML, for microdata. */
  html: string;
  /** Visible text of the page. */
  pageText: string;
};

/**
 * Price priority: JSON-LD Product/Offer, then meta tags, then microdata, then labeled text on the page.
 * (Gemini is the last resort and runs later, see urlExtraction.) Returns undefined when nothing trustworthy
 * is found: a missing price stays missing.
 */
export function extractPricing(sources: PriceSources): ProductPricing | undefined {
  const labeled = fromLabeledText(sources.pageText);
  const tiers = [fromJsonLd(sources.jsonLdProduct), fromMeta(sources.meta), fromMicrodata(sources.html), labeled];

  const chosen = tiers.find((tier) => tier?.current !== undefined);
  if (!chosen) return undefined;

  let original = chosen.original;
  let note = chosen.note;
  // A struck-through list price is usually only in the page text, even when the sale price is structured.
  if (original === undefined && labeled?.original !== undefined && chosen !== labeled && labeled.original > (chosen.current ?? 0)) {
    original = labeled.original;
    note = note ?? "정가는 상품 페이지 본문에서 읽었어요.";
  }

  return buildPricing({
    currentPrice: chosen.current,
    originalPrice: original,
    currency: chosen.currency ?? labeled?.currency,
    source: chosen.source,
    confidence: chosen.confidence,
    note,
  });
}

function fromJsonLd(product: JsonRecord | undefined): Candidate | undefined {
  if (!product) return undefined;
  const offers = collectOffers(product.offers);
  if (offers.length === 0) return undefined;

  const currencies = new Set<string>();
  const currents: number[] = [];
  let original: number | undefined;

  for (const offer of offers) {
    const specs = toArray(offer.priceSpecification).filter(isRecord);
    const specCurrent = specs.find((spec) => /sale|current/i.test(String(spec.priceType ?? "")));
    const specOriginal = specs.find((spec) => /list|strikethrough|msrp|srp|original/i.test(String(spec.priceType ?? "")));
    const plainSpec = specs.find((spec) => !spec.priceType);

    const current = parsePriceAmount(valueOf(offer.price ?? offer.lowPrice ?? specCurrent?.price ?? plainSpec?.price));
    if (current !== null) currents.push(current);

    const list = parsePriceAmount(valueOf(specOriginal?.price));
    if (list !== null) original = Math.max(original ?? 0, list);

    const currencyValue = offer.priceCurrency ?? specCurrent?.priceCurrency ?? plainSpec?.priceCurrency;
    const currency = normalizeCurrency(typeof currencyValue === "string" ? currencyValue : undefined);
    if (currency) currencies.add(currency);
  }

  if (currents.length === 0 || currencies.size !== 1) return undefined;

  const current = Math.min(...currents);
  const varies = new Set(currents).size > 1;
  return {
    current,
    original,
    currency: [...currencies][0],
    source: "structured-data",
    confidence: varies ? "low" : "high",
    note: varies ? "옵션마다 가격이 달라 가장 낮은 가격을 기준으로 했어요." : undefined,
  };
}

function fromMeta(meta: Record<string, string>): Candidate | undefined {
  const sale = parsePriceAmount(meta["product:sale_price:amount"]);
  const regular = parsePriceAmount(meta["product:price:amount"] ?? meta["og:price:amount"]);
  const listed = parsePriceAmount(meta["product:original_price:amount"] ?? meta["og:price:standard_amount"]);
  const currency = normalizeCurrency(meta["product:price:currency"] ?? meta["product:sale_price:currency"] ?? meta["og:price:currency"]);

  const current = sale ?? regular;
  if (current === null || !currency) return undefined;

  // When a sale price exists, the regular price field is the pre-discount price.
  const original = sale !== null ? (regular ?? listed ?? undefined) : (listed ?? undefined);
  return { current, original: original ?? undefined, currency, source: "meta", confidence: "medium" };
}

function fromMicrodata(html: string): Candidate | undefined {
  const priceTag = html.match(/<[^>]+itemprop=["']price["'][^>]*>/i)?.[0];
  if (!priceTag) return undefined;

  const content = priceTag.match(/content=["']([^"']+)["']/i)?.[1];
  const current = parsePriceAmount(content);
  const currencyTag = html.match(/<[^>]+itemprop=["']priceCurrency["'][^>]*>/i)?.[0];
  const currency = normalizeCurrency(currencyTag?.match(/content=["']([^"']+)["']/i)?.[1]);
  if (current === null || !currency) return undefined;

  return { current, currency, source: "structured-data", confidence: "medium" };
}

const saleLabels = ["할인가", "판매가", "세일가", "최종\\s*(?:가격|혜택가)", "혜택가", "현재가", "sale\\s*price", "special\\s*price", "\\bnow\\b"];
// Plain "price"/"가격" is only the current price when no qualifier ("original price", "할인 전 가격") precedes it.
const genericLabels = ["(?<!전\\s|최종\\s)가격", "(?<!original\\s|list\\s|regular\\s|retail\\s|sale\\s|special\\s)\\bprice\\b"];
const originalLabels = ["정가", "소비자가", "정상가", "할인\\s*전\\s*가격", "\\bwas\\b", "original\\s*price", "list\\s*price", "regular\\s*price", "retail\\s*price", "\\bmsrp\\b"];

// A price token must carry a currency marker: a bare number could be a size, a count or a model number.
const priceToken = /(?:(₩|US\$|\$|€|£|¥|KRW|USD|EUR|GBP|JPY)\s*)?(\d[\d,.]*\d|\d)\s*(원|KRW|USD|EUR|GBP|JPY|엔|円)?/i;

/** Public for the manual-text parser: finds a labeled price in free text. */
export function extractPricingFromText(text: string, source: ExtractionSource, confidence: "medium" | "low"): ProductPricing | undefined {
  const found = fromLabeledText(text);
  if (!found || found.current === undefined) {
    // A user-pasted description often has just one "59,000원"; accept it only when it is unambiguous.
    const lone = lonePrice(text);
    return lone ? buildPricing({ currentPrice: lone.amount, currency: lone.currency, source, confidence }) : undefined;
  }
  return buildPricing({ currentPrice: found.current, originalPrice: found.original, currency: found.currency, source, confidence });
}

function lonePrice(text: string) {
  const tokens = [...text.matchAll(new RegExp(priceToken.source, "gi"))]
    .map((match) => ({ amount: parsePriceAmount(match[2]), currency: detectCurrency(`${match[1] ?? ""}${match[3] ?? ""}`) }))
    .filter((token): token is { amount: number; currency: string } => token.amount !== null && token.currency !== undefined);
  const distinct = new Set(tokens.map((token) => token.amount));
  return distinct.size === 1 ? tokens[0] : undefined;
}

function fromLabeledText(text: string): Candidate | undefined {
  const original = findAfterLabel(text, originalLabels);
  const sale = findAfterLabel(text, saleLabels) ?? findAfterLabel(text, genericLabels);

  let current = sale;
  // "정가 79,000원 → 59,000원": the price right after a list price is the sale price.
  if (!current && original) {
    const following = text.slice(original.end, original.end + 40).match(priceToken);
    const amount = parsePriceAmount(following?.[2]);
    const currency = detectCurrency(`${following?.[1] ?? ""}${following?.[3] ?? ""}`);
    if (amount !== null && currency && amount < original.amount) current = { amount, currency, end: original.end };
  }

  if (!current && !original) return undefined;
  const currency = current?.currency ?? original?.currency;
  // A list price alone is not a current price, but it can still complete a sale price found elsewhere.
  if (!current) return { original: original?.amount, currency, source: "page", confidence: "low" };

  return {
    current: current.amount,
    original: original && original.amount > current.amount ? original.amount : undefined,
    currency,
    source: "page",
    confidence: "low",
  };
}

function findAfterLabel(text: string, labels: string[]) {
  const labelPattern = new RegExp(`(?:${labels.join("|")})\\s*[:：]?\\s*`, "gi");
  for (const label of text.matchAll(labelPattern)) {
    const start = (label.index ?? 0) + label[0].length;
    const window = text.slice(start, start + 24);
    const token = window.match(priceToken);
    if (!token || token.index === undefined || token.index > 6) continue;

    const amount = parsePriceAmount(token[2]);
    const currency = detectCurrency(`${token[1] ?? ""}${token[3] ?? ""}`);
    if (amount !== null && currency) return { amount, currency, end: start + token.index + token[0].length };
  }
  return undefined;
}

function collectOffers(value: unknown): JsonRecord[] {
  return toArray(value)
    .filter(isRecord)
    .flatMap((offer) => (offer.offers ? [offer, ...collectOffers(offer.offers)] : [offer]));
}

function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function valueOf(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
