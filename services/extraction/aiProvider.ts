import { getGeminiConfig } from "@/lib/env";
import type { ProductFacts } from "@/types/shopping";

export type PageExtractionInput = {
  url: string;
  title?: string;
  metaDescription?: string;
  pageText: string;
  structuredProduct?: Partial<ProductFacts>;
};

export type ProductExtractionProvider = {
  extract(input: PageExtractionInput): Promise<AiExtractionResult>;
  isAvailable(): boolean;
  providerName: "unavailable" | "mock" | "gemini";
};

export type AiExtractionResult = {
  product: Partial<ProductFacts>;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};

export type ExtractionErrorCode = "auth" | "quota" | "model" | "timeout" | "invalid_output" | "upstream";

/** Safe to show to users: it never carries provider messages, keys or request details. */
export class ExtractionProviderError extends Error {
  constructor(public code: ExtractionErrorCode) {
    super(`extraction provider failed: ${code}`);
    this.name = "ExtractionProviderError";
  }
}

export class UnavailableProductExtractionProvider implements ProductExtractionProvider {
  providerName = "unavailable" as const;

  isAvailable() {
    return false;
  }

  async extract(): Promise<AiExtractionResult> {
    return { product: {}, confidence: "low", warnings: [] };
  }
}

/** Picks Gemini when GEMINI_API_KEY is set; otherwise the app runs on deterministic extraction. */
export async function createProductExtractionProvider(): Promise<ProductExtractionProvider> {
  const result = getGeminiConfig();
  if (!result.ok) {
    if (result.reason === "invalid_model") console.warn("GEMINI_MODEL has an invalid format; Gemini extraction is disabled.");
    return new UnavailableProductExtractionProvider();
  }

  // Imported lazily so the SDK is only loaded when a key is configured.
  const { GeminiProductExtractionProvider } = await import("@/services/extraction/geminiProvider");
  return new GeminiProductExtractionProvider(result.config);
}
