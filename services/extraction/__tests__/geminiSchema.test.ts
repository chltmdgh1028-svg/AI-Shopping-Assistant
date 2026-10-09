import { describe, expect, it } from "vitest";
import { geminiProductSchema, geminiResponseJsonSchema, mapGeminiProduct, type GeminiProduct } from "@/services/extraction/geminiSchema";

const pageText =
  "울 블렌드 크루넥 니트 정가 79,000원 판매가 59,000원 혼용률 Wool 60% Nylon 25% Acrylic 15% 사이즈 M 어깨 46 가슴 106 총장 65 L 어깨 48 가슴 112 총장 67 세탁: 찬물 울코스 권장";

const valid: GeminiProduct = {
  productName: "울 블렌드 크루넥 니트",
  brand: null,
  category: "knitwear",
  currentPrice: 59000,
  originalPrice: 79000,
  currency: "KRW",
  description: null,
  materials: [
    { name: "Wool", percentage: 60, confidence: "high" },
    { name: "Nylon", percentage: 25, confidence: "high" },
    { name: "Acrylic", percentage: 15, confidence: "high" },
  ],
  sizes: [
    { name: "M", shoulder: 46, chest: 106, waist: null, hip: null, length: 65, sleeve: null, unit: "cm" },
    { name: "L", shoulder: 48, chest: 112, waist: null, hip: null, length: 67, sleeve: null, unit: "cm" },
  ],
  fit: "relaxed",
  careInstructions: ["세탁: 찬물 울코스 권장"],
  extractionConfidence: "high",
};

describe("geminiProductSchema", () => {
  it("accepts a well-formed response", () => {
    expect(geminiProductSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts explicit missing values", () => {
    const empty = { ...valid, productName: null, materials: [], sizes: [], fit: "unknown", careInstructions: [], extractionConfidence: "low" };
    expect(geminiProductSchema.safeParse(empty).success).toBe(true);
  });

  it("rejects out-of-range or malformed fields instead of coercing them", () => {
    expect(geminiProductSchema.safeParse({ ...valid, category: "shoes" }).success).toBe(false);
    expect(geminiProductSchema.safeParse({ ...valid, materials: [{ name: "Wool", percentage: 160, confidence: "high" }] }).success).toBe(false);
    expect(geminiProductSchema.safeParse({ ...valid, materials: [{ name: "Wool", percentage: "60", confidence: "high" }] }).success).toBe(false);
    expect(geminiProductSchema.safeParse({ ...valid, sizes: [{ ...valid.sizes[0], chest: -1 }] }).success).toBe(false);
    expect(geminiProductSchema.safeParse({ productName: "x" }).success).toBe(false);
    expect(geminiProductSchema.safeParse("not an object").success).toBe(false);
  });

  it("keeps the JSON Schema sent to Gemini in step with the zod schema", () => {
    const zodKeys = Object.keys(geminiProductSchema.shape).sort();
    expect(Object.keys(geminiResponseJsonSchema.properties).sort()).toEqual(zodKeys);
    expect([...geminiResponseJsonSchema.required].sort()).toEqual(zodKeys);
  });
});

describe("mapGeminiProduct", () => {
  it("maps verified facts to product facts marked as gemini-extracted", () => {
    const mapped = mapGeminiProduct(valid, pageText);

    expect(mapped.warnings).toEqual([]);
    expect(mapped.confidence).toBe("high");
    expect(mapped.product.materials).toEqual([
      { name: "Wool", percentage: 60, source: "gemini-extracted", confidence: "high" },
      { name: "Nylon", percentage: 25, source: "gemini-extracted", confidence: "high" },
      { name: "Acrylic", percentage: 15, source: "gemini-extracted", confidence: "high" },
    ]);
    expect(mapped.product.sizes?.[0]).toMatchObject({ name: "M", shoulder: 46, chest: 106, length: 65, unit: "cm", source: "gemini-extracted" });
    expect(mapped.product.fit).toBe("relaxed");
    expect(mapped.product.brand).toBeUndefined();
  });

  it("drops a material percentage that the page never states", () => {
    const hallucinated = { ...valid, materials: [...valid.materials, { name: "Cashmere", percentage: 10, confidence: "high" as const }] };
    const mapped = mapGeminiProduct(hallucinated, pageText);

    expect(mapped.product.materials?.map((item) => item.name)).toEqual(["Wool", "Nylon", "Acrylic"]);
    expect(mapped.warnings.join(" ")).toContain("Cashmere");
    expect(mapped.confidence).toBe("medium");
  });

  it("drops measurements that are not in the page and removes rows left empty", () => {
    const invented = {
      ...valid,
      sizes: [
        { name: "M", shoulder: 46, chest: 999, waist: null, hip: null, length: 65, sleeve: null, unit: "cm" as const },
        { name: "XL", shoulder: 77, chest: 88, waist: null, hip: null, length: 99, sleeve: null, unit: "cm" as const },
      ],
    };
    const mapped = mapGeminiProduct(invented, pageText);

    expect(mapped.product.sizes).toHaveLength(1);
    expect(mapped.product.sizes?.[0]).toMatchObject({ name: "M", shoulder: 46, length: 65 });
    expect(mapped.product.sizes?.[0].chest).toBeUndefined();
  });

  it("does not match a number inside a longer number", () => {
    const mapped = mapGeminiProduct(
      { ...valid, materials: [{ name: "Wool", percentage: 60, confidence: "high" }], sizes: [] },
      "Wool 160% silk",
    );
    expect(mapped.product.materials).toEqual([]);
  });

  it("converts inch measurements to cm and says so", () => {
    const inchPage = "Size M shoulder 18 chest 42 length 26";
    const mapped = mapGeminiProduct(
      { ...valid, materials: [], sizes: [{ name: "M", shoulder: 18, chest: 42, waist: null, hip: null, length: 26, sleeve: null, unit: "inch" }] },
      inchPage,
    );
    expect(mapped.product.sizes?.[0]).toMatchObject({ unit: "cm", shoulder: 45.7, chest: 106.7, length: 66 });
    expect(mapped.warnings.join(" ")).toContain("인치");
  });

  it("warns when the blend does not add up", () => {
    const mapped = mapGeminiProduct({ ...valid, materials: [{ name: "Wool", percentage: 60, confidence: "high" }], sizes: [] }, pageText);
    expect(mapped.warnings.join(" ")).toContain("합계");
  });

  it("returns low confidence and no facts when nothing could be verified", () => {
    const mapped = mapGeminiProduct({ ...valid, productName: null, currentPrice: null, originalPrice: null, currency: null, fit: "unknown" }, "아무 정보도 없는 페이지");
    expect(mapped.product.materials).toEqual([]);
    expect(mapped.product.sizes).toEqual([]);
    expect(mapped.confidence).toBe("low");
    expect(mapped.product.productName).toBeUndefined();
    expect(mapped.product.fit).toBeUndefined();
  });
});

describe("price mapping (Gemini is the last source, and never invents a price)", () => {
  it("maps a price the page prints, with its list price and the derived discount", () => {
    const mapped = mapGeminiProduct(valid, pageText);
    expect(mapped.product.pricing).toMatchObject({
      currentPrice: 59000,
      originalPrice: 79000,
      discountRate: 25,
      currency: "KRW",
      source: "gemini-extracted",
      confidence: "medium",
    });
    expect(mapped.product.price).toBe("₩59,000");
    expect(mapped.product.currency).toBe("KRW");
  });

  it("drops a current price that the page never prints, and says so", () => {
    const mapped = mapGeminiProduct({ ...valid, currentPrice: 65000 }, pageText);
    expect(mapped.product.pricing).toBeUndefined();
    expect(mapped.product.price).toBeUndefined();
    expect(mapped.warnings.join(" ")).toContain("가격");
  });

  it("keeps a verified current price but drops an unverified list price", () => {
    const mapped = mapGeminiProduct({ ...valid, originalPrice: 99000 }, pageText);
    expect(mapped.product.pricing).toMatchObject({ currentPrice: 59000 });
    expect(mapped.product.pricing?.originalPrice).toBeUndefined();
    expect(mapped.warnings.join(" ")).toContain("정가");
  });

  it("drops a price in a currency the page does not show", () => {
    expect(mapGeminiProduct({ ...valid, currency: "USD" }, pageText).product.pricing).toBeUndefined();
  });

  it("leaves the price missing when the model returns null", () => {
    const mapped = mapGeminiProduct({ ...valid, currentPrice: null, originalPrice: null, currency: null }, pageText);
    expect(mapped.product.pricing).toBeUndefined();
    expect(mapped.warnings).toEqual([]);
  });

  it("does not turn a converted or estimated number into a price", () => {
    // 59,000 KRW is roughly 43 USD; a model that converts would report 43.
    expect(mapGeminiProduct({ ...valid, currentPrice: 43, currency: "USD" }, pageText).product.pricing).toBeUndefined();
  });

  it("asks for numbers, not text, in the response schema", () => {
    expect(geminiResponseJsonSchema.properties.currentPrice.type).toEqual(["number", "null"]);
    expect(geminiResponseJsonSchema.properties.originalPrice.type).toEqual(["number", "null"]);
    expect(geminiProductSchema.safeParse({ ...valid, currentPrice: "59,000원" }).success).toBe(false);
    expect(geminiProductSchema.safeParse({ ...valid, currentPrice: -1 }).success).toBe(false);
  });
});
