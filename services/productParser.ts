import { readMaterialShares } from "@/domain/materialParsing";
import { applyBundle, formatPrice } from "@/domain/pricing";
import { extractPricingFromText } from "@/services/extraction/priceExtraction";
import { demoProduct } from "@/data/demoProduct";
import type { ProductFacts, ProductInput } from "@/types/shopping";

// Slightly above the server's own limits (link resolution 6s + page fetch 8s + Gemini 28s) so the server reports first.
const ANALYZE_REQUEST_TIMEOUT_MS = 58_000;

export type ProductParser = {
  parse(input: ProductInput): Promise<ProductFacts>;
};

export class MockProductParser implements ProductParser {
  async parse(input: ProductInput): Promise<ProductFacts> {
    await new Promise((resolve) => setTimeout(resolve, 450));

    if (input.url?.includes("demo") || !input.manualText) {
      return {
        ...demoProduct,
        sourceUrl: input.url || demoProduct.sourceUrl,
      };
    }

    return parseManualText(input.manualText, input.url);
  }
}

export class HybridProductParser implements ProductParser {
  async parse(input: ProductInput): Promise<ProductFacts> {
    if (input.manualText) return parseManualText(input.manualText, input.url);
    if (!input.url || input.url.includes("demo.shopping-assistant.local")) {
      return {
        ...demoProduct,
        sourceUrl: input.url || demoProduct.sourceUrl,
      };
    }

    let response: Response;
    try {
      response = await fetch("/api/analyze-url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: input.url }),
        signal: AbortSignal.timeout(ANALYZE_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ProductAnalysisError("분석 서버에 연결하지 못했어요. 잠시 후 다시 시도하거나 상품 설명을 직접 입력해 주세요.", "network_error");
    }

    const payload = (await response.json().catch(() => ({}))) as { product?: ProductFacts; error?: string; code?: string };
    if (!response.ok || !payload.product) {
      throw new ProductAnalysisError(payload.error ?? "상품 URL을 자동으로 분석하지 못했습니다.", payload.code ?? "analysis_failed");
    }
    return payload.product;
  }
}

export class ProductAnalysisError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = "ProductAnalysisError";
  }
}

function manualPricing(text: string, name: string) {
  const pricing = applyBundle(extractPricingFromText(text, "user-input", "medium"), name, text);
  return pricing ? { pricing, price: formatPrice(pricing.currentPrice, pricing.currency), currency: pricing.currency } : {};
}

export function parseManualText(manualText: string, sourceUrl?: string): ProductFacts {
  const lower = manualText.toLowerCase();
  const materials = readMaterialShares(manualText, "user-input", "medium");

  const category = lower.includes("knit") || manualText.includes("니트") ? "knitwear" : "unknown";

  return {
    productName: manualText.split("\n").find(Boolean)?.slice(0, 42) || "직접 입력한 상품",
    brand: undefined,
    category,
    ...manualPricing(manualText, manualText.split("\n").find(Boolean) ?? ""),
    images: [],
    description: manualText,
    materials,
    sizes: extractSizes(manualText),
    fit: lower.includes("oversized") || manualText.includes("오버") ? "oversized" : undefined,
    careInstructions: manualText
      .split("\n")
      .filter((line) => /세탁|건조|드라이|비틀|표백|다림질|wash|dry|bleach|wring|iron/i.test(line))
      .slice(0, 8),
    sourceUrl,
    factsSource: "manual_input",
    extractionMetadata: {
      strategy: ["manual"],
      status: materials.length || extractSizes(manualText).length ? "partial" : "failed",
      confidence: "medium",
      aiProvider: "unavailable",
      warnings: [
        ...(materials.length ? [] : ["직접 입력 내용에서 소재 혼용률을 찾지 못했습니다."]),
        ...(extractSizes(manualText).length ? [] : ["직접 입력 내용에서 사이즈표를 찾지 못했습니다."]),
      ],
    },
  };
}

function extractSizes(text: string) {
  const sizeRows = text.matchAll(/(M|L|XL|S)\s*[:-]?\s*(?:어깨\s*)?(\d{2,3}).*?(?:가슴|chest)\s*(\d{2,3}).*?(?:총장|length)\s*(\d{2,3})/gi);
  return Array.from(sizeRows).map((match) => ({
    name: match[1].toUpperCase(),
    shoulder: Number(match[2]),
    chest: Number(match[3]),
    length: Number(match[4]),
    unit: "cm" as const,
    source: "user-input" as const,
    confidence: "medium" as const,
  }));
}
