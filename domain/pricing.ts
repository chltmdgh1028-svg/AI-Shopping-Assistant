import type { ExtractionConfidence, ExtractionSource, ProductPricing } from "@/types/shopping";

const currencyMarkers: Array<[RegExp, string]> = [
  [/₩|원|\bKRW\b/i, "KRW"],
  [/US\$|\bUSD\b|\$/i, "USD"],
  [/€|\bEUR\b/i, "EUR"],
  [/£|\bGBP\b/i, "GBP"],
  [/円|엔|\bJPY\b|¥/i, "JPY"],
  [/\bCNY\b|\bRMB\b|元|위안/i, "CNY"],
];

// Currencies that are quoted in whole units: a "price" of 59 KRW is a parsing mistake, not a bargain.
const minimumPlausible: Record<string, number> = { KRW: 1000, JPY: 100 };
const maxAmount = 1_000_000_000;

export function detectCurrency(text: string): string | undefined {
  return currencyMarkers.find(([pattern]) => pattern.test(text))?.[1];
}

/** True when the text itself shows a marker for this currency (symbol, suffix or code). */
export function mentionsCurrency(text: string, code: string) {
  return currencyMarkers.some(([pattern, marker]) => marker === code && pattern.test(text));
}

let knownCurrencies: Set<string> | undefined;

/** Only real ISO 4217 codes count: "WON" or "ABC" would otherwise pass a three-letter check. */
export function normalizeCurrency(code: string | undefined | null): string | undefined {
  const upper = code?.trim().toUpperCase();
  if (!upper || !/^[A-Z]{3}$/.test(upper)) return undefined;
  knownCurrencies ??= new Set(Intl.supportedValuesOf("currency"));
  return knownCurrencies.has(upper) ? upper : undefined;
}

/**
 * Reads a number out of a price string. Handles 59,000 / 59000 / 59.000 / 1,299.00 / 1.299,00 / 59,90.
 * A lone separator followed by exactly three digits is a thousands separator; otherwise it is decimal.
 */
export function parsePriceAmount(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 && raw < maxAmount ? raw : null;

  const cleaned = raw.replace(/[^\d.,]/g, "");
  if (!/\d/.test(cleaned)) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");
  let normalized: string;

  if (lastComma !== -1 && lastDot !== -1) {
    // Both present: the later one is the decimal mark.
    const decimalMark = lastComma > lastDot ? "," : ".";
    const thousandsMark = decimalMark === "," ? "." : ",";
    normalized = cleaned.split(thousandsMark).join("").replace(decimalMark, ".");
  } else if (lastComma !== -1 || lastDot !== -1) {
    const mark = lastComma !== -1 ? "," : ".";
    const parts = cleaned.split(mark);
    const tail = parts[parts.length - 1];
    const isThousands = parts.length > 2 || tail.length === 3;
    normalized = isThousands ? parts.join("") : `${parts.slice(0, -1).join("")}.${tail}`;
  } else {
    normalized = cleaned;
  }

  const value = Number(normalized);
  return Number.isFinite(value) && value > 0 && value < maxAmount ? value : null;
}

export function discountRate(currentPrice: number, originalPrice: number) {
  if (!(originalPrice > currentPrice) || currentPrice <= 0) return undefined;
  return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
}

export type PricingInput = {
  currentPrice: number | null | undefined;
  originalPrice?: number | null;
  currency: string | null | undefined;
  source: ExtractionSource;
  confidence: ExtractionConfidence;
  note?: string;
};

/**
 * Builds a ProductPricing only when the numbers are believable. A missing or implausible price returns
 * undefined: the caller must treat that as "unknown", never as a default.
 */
export function buildPricing(input: PricingInput): ProductPricing | undefined {
  const currency = normalizeCurrency(input.currency);
  const current = input.currentPrice ?? null;
  if (!currency || current === null || !(current > 0) || current >= maxAmount) return undefined;
  if (current < (minimumPlausible[currency] ?? 0)) return undefined;

  let original = input.originalPrice ?? undefined;
  let note = input.note;
  if (original !== undefined) {
    const rate = discountRate(current, original);
    // An "original" price that is not higher, or implies a 90%+ discount, is more likely a mismatch than a deal.
    if (rate === undefined || rate >= 90 || original >= maxAmount) {
      original = undefined;
      note = note ?? "정가로 보이는 값이 현재가와 맞지 않아 제외했어요.";
    }
  }

  return {
    currentPrice: current,
    originalPrice: original,
    discountRate: original !== undefined ? discountRate(current, original) : undefined,
    currency,
    source: input.source,
    confidence: input.confidence,
    note,
  };
}

export function formatPrice(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat("ko-KR", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "KRW" || currency === "JPY" ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("ko-KR")} ${currency}`;
  }
}

/** Every number-like token in a text, as the values it could mean. Used to check a model-reported price against the page. */
export function numberTokens(text: string): Set<number> {
  const values = new Set<number>();
  for (const match of text.matchAll(/\d[\d,.]*\d|\d/g)) {
    const token = match[0];
    const parsed = parsePriceAmount(token);
    if (parsed !== null) values.add(parsed);
    // "59.000" may be 59000 in a locale that uses dots as thousands marks.
    const digitsOnly = Number(token.replace(/[^\d]/g, ""));
    if (Number.isFinite(digitsOnly) && digitsOnly > 0) values.add(digitsOnly);
  }
  return values;
}

// "[1+1]" in a name is a promotion label, not a statement of what is in the box: some shops mean a free gift,
// some mean a second colour. The count is only trusted when the page text spells it out.
const bundleHint = /1\s*\+\s*1|원\s*플러스\s*원|buy\s*one\s*,?\s*get\s*one|\bbogo\b/i;
const bundleConfirmations = [
  /1\s*\+\s*1[^.\n]{0,40}(2\s*(개|벌|장|매|pcs|pieces|items?)|두\s*(개|벌|장)|총\s*2)/i,
  /2\s*(개|벌|장|매)\s*(구성|세트|제공|증정|발송|묶음)/,
  /set\s*of\s*2|\b2[\s-]*(pack|pcs|pieces)\b/i,
  /1\s*\+\s*1[^.\n]{0,24}(추가\s*증정|무료\s*증정|동일\s*상품|같은\s*상품|함께\s*(발송|배송))/,
];

const wholeUnitCurrencies = new Set(["KRW", "JPY"]);

/**
 * Adds the per-piece price when the page confirms the price buys two. Without that confirmation the price is
 * left exactly as listed and the pricing only records that a bundle label exists.
 */
export function applyBundle(pricing: ProductPricing | undefined, productName: string, pageText: string): ProductPricing | undefined {
  if (!pricing) return undefined;
  const hinted = bundleHint.test(productName) || bundleHint.test(pageText);
  if (!hinted) return pricing;

  if (!bundleConfirmations.some((pattern) => pattern.test(pageText) || pattern.test(productName))) {
    return { ...pricing, bundleUnconfirmed: true };
  }

  const bundleQuantity = 2;
  const unit = pricing.currentPrice / bundleQuantity;
  return {
    ...pricing,
    promotionType: "bundle",
    bundleQuantity,
    unitPrice: wholeUnitCurrencies.has(pricing.currency) ? Math.round(unit) : Math.round(unit * 100) / 100,
    bundleUnconfirmed: undefined,
  };
}

/** How a price reads in the UI and in sentences: Korean won as "59,900원", other currencies as formatPrice. */
export function formatPriceLabel(amount: number, currency: string) {
  return currency === "KRW" ? `${Math.round(amount).toLocaleString("ko-KR")}원` : formatPrice(amount, currency);
}
