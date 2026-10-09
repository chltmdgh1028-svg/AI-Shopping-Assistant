import { describe, expect, it } from "vitest";
import { extractProductFromHtml } from "@/services/extraction/htmlExtraction";
import { extractPricing, extractPricingFromText } from "@/services/extraction/priceExtraction";

const sources = (overrides: Partial<Parameters<typeof extractPricing>[0]> = {}) => ({ meta: {}, html: "", pageText: "", ...overrides });

const jsonLd = (offers: unknown) => ({ "@type": "Product", name: "니트", offers });

describe("JSON-LD prices (priority 1)", () => {
  it("reads current price and currency from an Offer", () => {
    const pricing = extractPricing(sources({ jsonLdProduct: jsonLd({ "@type": "Offer", price: "59000", priceCurrency: "KRW" }) }));
    expect(pricing).toMatchObject({ currentPrice: 59000, currency: "KRW", source: "structured-data", confidence: "high" });
    expect(pricing?.originalPrice).toBeUndefined();
  });

  it("reads a numeric price and a formatted string price", () => {
    expect(extractPricing(sources({ jsonLdProduct: jsonLd({ price: 89000, priceCurrency: "KRW" }) }))?.currentPrice).toBe(89000);
    expect(extractPricing(sources({ jsonLdProduct: jsonLd({ price: "1,299.00", priceCurrency: "USD" }) }))?.currentPrice).toBe(1299);
  });

  it("separates sale price from list price using priceSpecification", () => {
    const pricing = extractPricing(
      sources({
        jsonLdProduct: jsonLd({
          priceCurrency: "KRW",
          priceSpecification: [
            { "@type": "UnitPriceSpecification", priceType: "https://schema.org/ListPrice", price: 79000, priceCurrency: "KRW" },
            { "@type": "UnitPriceSpecification", priceType: "https://schema.org/SalePrice", price: 59000, priceCurrency: "KRW" },
          ],
        }),
      }),
    );
    expect(pricing).toMatchObject({ currentPrice: 59000, originalPrice: 79000, discountRate: 25 });
  });

  it("uses the lowest option price with lower confidence when variants differ", () => {
    const pricing = extractPricing(
      sources({
        jsonLdProduct: jsonLd([
          { price: 69000, priceCurrency: "KRW" },
          { price: 59000, priceCurrency: "KRW" },
        ]),
      }),
    );
    expect(pricing).toMatchObject({ currentPrice: 59000, confidence: "low" });
    expect(pricing?.note).toContain("옵션");
  });

  it("refuses an offer with no currency instead of guessing one", () => {
    expect(extractPricing(sources({ jsonLdProduct: jsonLd({ price: "59000" }) }))).toBeUndefined();
  });
});

describe("meta tags (priority 2)", () => {
  it("treats product:price as the original when a sale price exists", () => {
    const pricing = extractPricing(
      sources({ meta: { "product:price:amount": "79000", "product:sale_price:amount": "59000", "product:price:currency": "KRW" } }),
    );
    expect(pricing).toMatchObject({ currentPrice: 59000, originalPrice: 79000, source: "meta" });
  });

  it("reads a plain product:price", () => {
    expect(extractPricing(sources({ meta: { "og:price:amount": "35.00", "og:price:currency": "USD" } }))).toMatchObject({ currentPrice: 35, currency: "USD" });
  });
});

describe("microdata and page text (priority 3)", () => {
  it("reads itemprop price", () => {
    const html = '<span itemprop="price" content="49000"></span><meta itemprop="priceCurrency" content="KRW">';
    expect(extractPricing(sources({ html }))).toMatchObject({ currentPrice: 49000, currency: "KRW" });
  });

  it("reads labeled list and sale prices from the page", () => {
    const pricing = extractPricing(sources({ pageText: "라운드 니트 정가 79,000원 판매가 59,000원 배송비 3,000원" }));
    expect(pricing).toMatchObject({ currentPrice: 59000, originalPrice: 79000, discountRate: 25, source: "page", confidence: "low" });
  });

  it("reads 'list price then sale price' without a second label", () => {
    expect(extractPricing(sources({ pageText: "정가 79,000원 → 59,000원 (25% 할인)" }))).toMatchObject({ currentPrice: 59000, originalPrice: 79000 });
  });

  it("does not take a list price as the current price", () => {
    expect(extractPricing(sources({ pageText: "Original price $79" }))).toBeUndefined();
    expect(extractPricing(sources({ pageText: "할인 전 가격 79,000원" }))).toBeUndefined();
  });

  it("ignores bare numbers: a size, a model number or shipping is not a price", () => {
    expect(extractPricing(sources({ pageText: "사이즈 M 46 가슴 106 상품번호 1053632 배송비 3,000원 적립 590원" }))).toBeUndefined();
  });

  it("requires a currency marker next to a labeled number", () => {
    expect(extractPricing(sources({ pageText: "판매가 59000" }))).toBeUndefined();
  });
});

describe("priority between sources", () => {
  it("prefers JSON-LD over meta over page text", () => {
    const pricing = extractPricing(
      sources({
        jsonLdProduct: jsonLd({ price: 59000, priceCurrency: "KRW" }),
        meta: { "product:price:amount": "48000", "product:price:currency": "KRW" },
        pageText: "판매가 99,000원",
      }),
    );
    expect(pricing).toMatchObject({ currentPrice: 59000, source: "structured-data" });
  });

  it("adds a list price from the page text to a structured sale price", () => {
    const pricing = extractPricing(sources({ jsonLdProduct: jsonLd({ price: 59000, priceCurrency: "KRW" }), pageText: "정가 79,000원" }));
    expect(pricing).toMatchObject({ currentPrice: 59000, originalPrice: 79000, discountRate: 25 });
  });

  it("returns nothing when no source has a price", () => {
    expect(extractPricing(sources({ pageText: "아주 멋진 니트입니다" }))).toBeUndefined();
  });
});

describe("pricing inside a full page", () => {
  it("is attached to the product, with the display string and currency", () => {
    const html = `<html><head><title>니트</title><script type="application/ld+json">${JSON.stringify(jsonLd({ price: "59000", priceCurrency: "KRW" }))}</script></head><body>Wool 70% Nylon 30%</body></html>`;
    const product = extractProductFromHtml(html, "https://shop.example.com/a");
    expect(product.pricing).toMatchObject({ currentPrice: 59000, currency: "KRW" });
    expect(product.price).toBe("₩59,000");
    expect(product.currency).toBe("KRW");
  });

  it("warns, and keeps the price missing, when the page has none", () => {
    const product = extractProductFromHtml("<html><head><title>니트</title></head><body>Wool 70% Nylon 30%</body></html>", "https://shop.example.com/a");
    expect(product.pricing).toBeUndefined();
    expect(product.price).toBeUndefined();
    expect(product.extractionMetadata?.warnings.join(" ")).toContain("가격");
  });
});

describe("pasted descriptions", () => {
  it("reads a labeled price", () => {
    expect(extractPricingFromText("니트\n정가 79,000원\n판매가 59,000원", "user-input", "medium")).toMatchObject({
      currentPrice: 59000,
      originalPrice: 79000,
      source: "user-input",
    });
  });

  it("accepts a lone unambiguous price", () => {
    expect(extractPricingFromText("울 니트 59,000원 Wool 60%", "user-input", "medium")).toMatchObject({ currentPrice: 59000, currency: "KRW" });
  });

  it("does not guess between several unlabeled prices", () => {
    expect(extractPricingFromText("울 니트 59,000원 배송 3,000원", "user-input", "medium")).toBeUndefined();
  });
});
