import { describe, expect, it } from "vitest";
import {
  ExtractionProviderError,
  UnavailableProductExtractionProvider,
  type ProductExtractionProvider,
} from "@/services/extraction/aiProvider";
import { extractProductFromUrl } from "@/services/extraction/urlExtraction";

const html = (body: string, head = "") => `<html><head><title>Shop</title>${head}</head><body>${body}</body></html>`;

const jsonLd = `<script type="application/ld+json">${JSON.stringify({
  "@type": "Product",
  name: "라운드 울 니트",
  brand: { name: "Maison" },
  offers: { price: "89000", priceCurrency: "KRW" },
  description: "부드러운 울 니트",
})}</script>`;

const fetcher = (page: string) => async () => ({ ok: true as const, html: page, finalUrl: "https://shop.example.com/knit" });

const geminiLike = (overrides: Partial<ProductExtractionProvider> = {}): ProductExtractionProvider => ({
  providerName: "gemini",
  isAvailable: () => true,
  extract: async () => ({
    product: {
      materials: [{ name: "Wool", percentage: 80, source: "gemini-extracted", confidence: "high" }],
      sizes: [{ name: "M", chest: 100, length: 64, unit: "cm", source: "gemini-extracted", confidence: "medium" }],
      productName: "AI가 읽은 이름",
      careInstructions: ["세탁: 찬물 손세탁"],
    },
    confidence: "high",
    warnings: [],
  }),
  ...overrides,
});

describe("AI extraction provider fallback", () => {
  it("is unavailable without environment configuration and returns no invented facts", async () => {
    const provider = new UnavailableProductExtractionProvider();

    expect(provider.isAvailable()).toBe(false);
    await expect(provider.extract()).resolves.toEqual({ product: {}, confidence: "low", warnings: [] });
  });
});

describe("extractProductFromUrl", () => {
  const page = html("<p>Wool 60% Nylon 40%</p>", jsonLd);

  it("passes fetch failures through unchanged", async () => {
    const result = await extractProductFromUrl("https://shop.example.com", undefined, async () => ({
      ok: false as const,
      code: "blocked_url" as const,
      message: "blocked",
    }));
    expect(result).toEqual({ ok: false, code: "blocked_url", message: "blocked" });
  });

  it("falls back to deterministic extraction when Gemini is not configured", async () => {
    const result = await extractProductFromUrl("https://shop.example.com/knit", new UnavailableProductExtractionProvider(), fetcher(page));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.productName).toBe("라운드 울 니트");
    expect(result.product.materials.map((item) => item.name)).toEqual(["Wool", "Nylon"]);
    expect(result.product.extractionMetadata).toMatchObject({ aiProvider: "unavailable", aiStatus: "not_configured", status: "partial" });
    expect(result.partial).toBe(true);
  });

  it("uses Gemini results for materials and sizes but keeps structured-data identity", async () => {
    const result = await extractProductFromUrl("https://shop.example.com/knit", geminiLike(), fetcher(page));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.productName).toBe("라운드 울 니트");
    expect(result.product.brand).toBe("Maison");
    expect(result.product.materials).toEqual([{ name: "Wool", percentage: 80, source: "gemini-extracted", confidence: "high" }]);
    expect(result.product.sizes).toHaveLength(1);
    expect(result.product.careInstructions).toEqual(["세탁: 찬물 손세탁"]);
    expect(result.product.extractionMetadata).toMatchObject({ aiProvider: "gemini", aiStatus: "used", status: "complete" });
    expect(result.product.extractionMetadata?.strategy).toContain("ai-adapter");
  });

  it("takes the product name from Gemini when the page has no structured data", async () => {
    const result = await extractProductFromUrl("https://shop.example.com/knit", geminiLike(), fetcher(html("<p>hello</p>")));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.productName).toBe("AI가 읽은 이름");
  });

  it("never takes images from Gemini", async () => {
    const withImage = html("<p>x</p>", `${jsonLd}<meta property="og:image" content="https://cdn.example.com/a.jpg">`);
    const result = await extractProductFromUrl("https://shop.example.com/knit", geminiLike(), fetcher(withImage));

    expect(result.ok && result.product.images).toEqual(["https://cdn.example.com/a.jpg"]);
  });

  it.each([
    ["quota", "사용량"],
    ["timeout", "오래"],
    ["invalid_output", "확인하지 못해"],
    ["upstream", "일시적"],
  ] as const)("keeps the analysis alive when Gemini fails with %s", async (code, hint) => {
    const failing = geminiLike({
      extract: async () => {
        throw new ExtractionProviderError(code);
      },
    });
    const result = await extractProductFromUrl("https://shop.example.com/knit", failing, fetcher(page));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.productName).toBe("라운드 울 니트");
    expect(result.product.materials.length).toBeGreaterThan(0);
    expect(result.product.extractionMetadata).toMatchObject({ aiProvider: "unavailable", aiStatus: "failed" });
    expect(result.product.extractionMetadata?.warnings.join(" ")).toContain(hint);
    expect(JSON.stringify(result.product)).not.toContain("ExtractionProviderError");
  });

  it("treats an unexpected non-provider error from Gemini the same way", async () => {
    const failing = geminiLike({
      extract: async () => {
        throw new TypeError("kaboom");
      },
    });
    const result = await extractProductFromUrl("https://shop.example.com/knit", failing, fetcher(page));
    expect(result.ok && result.product.extractionMetadata?.aiStatus).toBe("failed");
  });

  it("handles a page with no product facts at all", async () => {
    const result = await extractProductFromUrl("https://shop.example.com/x", new UnavailableProductExtractionProvider(), fetcher("<html><body></body></html>"));

    // Nothing readable: no product name, so the caller is told to ask for manual input.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("empty_result");
  });

  it("reports missing fields as warnings instead of inventing them", async () => {
    const result = await extractProductFromUrl("https://shop.example.com/knit", new UnavailableProductExtractionProvider(), fetcher(html("<p>멋진 상품</p>", jsonLd)));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.product.materials).toEqual([]);
    expect(result.product.sizes).toEqual([]);
    expect(result.product.extractionMetadata?.warnings.join(" ")).toContain("소재");
  });
});
