import { describe, expect, it } from "vitest";
import { buildPricing, detectCurrency, discountRate, formatPrice, mentionsCurrency, numberTokens, parsePriceAmount } from "@/domain/pricing";

describe("parsePriceAmount", () => {
  it.each([
    ["59,000", 59000],
    ["59000", 59000],
    ["59.000", 59000], // dot as thousands mark
    ["₩59,000원", 59000],
    ["1,299.00", 1299.0],
    ["1.299,00", 1299.0],
    ["59.90", 59.9],
    ["59,90", 59.9],
    ["1,234,567", 1234567],
    ["$1,299", 1299],
  ])("reads %s as %s", (raw, expected) => {
    expect(parsePriceAmount(raw)).toBe(expected);
  });

  it("returns null for anything that is not a price", () => {
    expect(parsePriceAmount("")).toBeNull();
    expect(parsePriceAmount("무료")).toBeNull();
    expect(parsePriceAmount(null)).toBeNull();
    expect(parsePriceAmount(undefined)).toBeNull();
    expect(parsePriceAmount(0)).toBeNull();
    expect(parsePriceAmount(-5)).toBeNull();
    expect(parsePriceAmount(Number.NaN)).toBeNull();
  });

  it("accepts plain numbers", () => {
    expect(parsePriceAmount(59000)).toBe(59000);
  });
});

describe("currency detection", () => {
  it("reads symbols, suffixes and codes", () => {
    expect(detectCurrency("₩59,000")).toBe("KRW");
    expect(detectCurrency("59,000원")).toBe("KRW");
    expect(detectCurrency("US$ 59")).toBe("USD");
    expect(detectCurrency("$59")).toBe("USD");
    expect(detectCurrency("€59")).toBe("EUR");
    expect(detectCurrency("59")).toBeUndefined();
  });

  it("checks that a text itself mentions a currency", () => {
    expect(mentionsCurrency("판매가 59,000원", "KRW")).toBe(true);
    expect(mentionsCurrency("판매가 59,000원", "USD")).toBe(false);
  });
});

describe("discountRate", () => {
  it("is derived from the two prices as a whole percent", () => {
    expect(discountRate(59000, 79000)).toBe(25);
    expect(discountRate(50, 100)).toBe(50);
  });

  it("is undefined when there is no discount", () => {
    expect(discountRate(79000, 79000)).toBeUndefined();
    expect(discountRate(90000, 79000)).toBeUndefined();
    expect(discountRate(0, 79000)).toBeUndefined();
  });
});

describe("buildPricing", () => {
  const base = { currency: "KRW", source: "structured-data" as const, confidence: "high" as const };

  it("keeps the sale price as the current price and derives the discount", () => {
    expect(buildPricing({ ...base, currentPrice: 59000, originalPrice: 79000 })).toMatchObject({
      currentPrice: 59000,
      originalPrice: 79000,
      discountRate: 25,
      currency: "KRW",
    });
  });

  it("returns undefined for a missing price, never a default", () => {
    expect(buildPricing({ ...base, currentPrice: null })).toBeUndefined();
    expect(buildPricing({ ...base, currentPrice: undefined })).toBeUndefined();
    expect(buildPricing({ ...base, currentPrice: 59000, currency: null })).toBeUndefined();
    expect(buildPricing({ ...base, currentPrice: 59000, currency: "won" })).toBeUndefined();
  });

  it("rejects implausible whole-unit prices (a size or count read as money)", () => {
    expect(buildPricing({ ...base, currentPrice: 59 })).toBeUndefined();
    expect(buildPricing({ ...base, currentPrice: 59, currency: "USD" })).toBeDefined();
  });

  it("drops a list price that is not higher or implies a 90%+ discount", () => {
    expect(buildPricing({ ...base, currentPrice: 59000, originalPrice: 59000 })?.originalPrice).toBeUndefined();
    expect(buildPricing({ ...base, currentPrice: 59000, originalPrice: 40000 })?.originalPrice).toBeUndefined();
    expect(buildPricing({ ...base, currentPrice: 5900, originalPrice: 590000 })?.originalPrice).toBeUndefined();
  });
});

describe("formatPrice and numberTokens", () => {
  it("formats won without decimals", () => {
    expect(formatPrice(59000, "KRW")).toBe("₩59,000");
  });

  it("lists the numbers a page actually prints", () => {
    const tokens = numberTokens("정가 79,000원 판매가 59,000원 (사이즈 M 46)");
    expect(tokens.has(79000)).toBe(true);
    expect(tokens.has(59000)).toBe(true);
    expect(tokens.has(46)).toBe(true);
    expect(tokens.has(65000)).toBe(false);
  });
});
