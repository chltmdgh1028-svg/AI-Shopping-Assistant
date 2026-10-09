import { describe, expect, it } from "vitest";
import { UnavailableProductExtractionProvider, type ProductExtractionProvider } from "@/services/extraction/aiProvider";
import { extractProductFromUrl } from "@/services/extraction/urlExtraction";
import type { ProductFacts } from "@/types/shopping";

// Price priority is JSON-LD, then meta, then page text, then Gemini. Gemini never overrides the page.

const ldScript = (data: object) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const page = (head: string, body = "<p>Wool 60%</p>") => `<html><head><title>Shop</title>${head}</head><body>${body}</body></html>`;
const fetcher = (html: string) => async () => ({ ok: true as const, html, finalUrl: "https://shop.example.com/knit" });

const withPrice = ldScript({ "@type": "Product", name: "니트", offers: { price: "89000", priceCurrency: "KRW" } });
const withoutPrice = ldScript({ "@type": "Product", name: "니트" });

const aiPricing = (currentPrice: number, originalPrice?: number): NonNullable<ProductFacts["pricing"]> => ({
  currentPrice,
  originalPrice,
  discountRate: originalPrice ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100) : undefined,
  currency: "KRW",
  source: "gemini-extracted",
  confidence: "medium",
});

const gemini = (pricing: NonNullable<ProductFacts["pricing"]>): ProductExtractionProvider => ({
  providerName: "gemini",
  isAvailable: () => true,
  extract: async () => ({
    product: { materials: [{ name: "Wool", percentage: 80, source: "gemini-extracted", confidence: "high" }], pricing },
    confidence: "high",
    warnings: [],
  }),
});

describe("price merge", () => {
  it("keeps the page's JSON-LD price even when Gemini reports a different one", async () => {
    const result = await extractProductFromUrl("https://shop.example.com/knit", gemini(aiPricing(1000)), fetcher(page(withPrice)));
    expect(result.ok && result.product.pricing).toMatchObject({ currentPrice: 89000, source: "structured-data" });
    expect(result.ok && result.product.price).toBe("₩89,000");
  });

  it("uses Gemini's price only when the page has none", async () => {
    const result = await extractProductFromUrl("https://shop.example.com/knit", gemini(aiPricing(59000, 79000)), fetcher(page(withoutPrice)));
    expect(result.ok && result.product.pricing).toMatchObject({ currentPrice: 59000, originalPrice: 79000, source: "gemini-extracted" });
    expect(result.ok && result.product.price).toBe("₩59,000");
  });

  it("adds Gemini's list price to a page price that has none, when currencies agree", async () => {
    const result = await extractProductFromUrl("https://shop.example.com/knit", gemini(aiPricing(89000, 120000)), fetcher(page(withPrice)));
    expect(result.ok && result.product.pricing).toMatchObject({ currentPrice: 89000, originalPrice: 120000, discountRate: 26, source: "structured-data" });
  });

  it("ignores Gemini's list price when its currency differs from the page's", async () => {
    const usd = { ...aiPricing(70, 100), currency: "USD" };
    const result = await extractProductFromUrl("https://shop.example.com/knit", gemini(usd), fetcher(page(withPrice)));
    expect(result.ok && result.product.pricing?.originalPrice).toBeUndefined();
  });

  it("warns about a missing price instead of inventing one", async () => {
    const result = await extractProductFromUrl("https://shop.example.com/x", new UnavailableProductExtractionProvider(), fetcher(page(withoutPrice)));
    expect(result.ok && result.product.pricing).toBeUndefined();
    expect(result.ok && result.product.price).toBeUndefined();
    expect(result.ok && result.product.extractionMetadata?.warnings.join(" ")).toContain("가격");
  });

  it("reads the page's own labeled prices before asking Gemini at all", async () => {
    const result = await extractProductFromUrl(
      "https://shop.example.com/knit",
      new UnavailableProductExtractionProvider(),
      fetcher(page(withoutPrice, "<p>정가 79,000원 판매가 59,000원 Wool 60%</p>")),
    );
    expect(result.ok && result.product.pricing).toMatchObject({ currentPrice: 59000, originalPrice: 79000, source: "page" });
  });
});
