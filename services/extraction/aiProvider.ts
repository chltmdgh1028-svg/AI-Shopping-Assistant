import { getGeminiConfig } from "@/lib/env";
import type { ExtractionConfidence, MaterialBlend, ProductFacts, ProductSize } from "@/types/shopping";

export type PageExtractionInput = {
  url: string;
  title?: string;
  metaDescription?: string;
  pageText: string;
  structuredProduct?: Partial<ProductFacts>;
};

/** One image for a vision model: raw bytes as base64, with its MIME type. */
export type ImageInput = { mimeType: string; data: string };

export type ImageExtractionInput = {
  url: string;
  images: ImageInput[];
  /** What the text left empty. The model is asked for all three but only these may be used. */
  want: Array<"materials" | "sizes" | "care">;
  budgetMs: number;
};

export type ImageExtractionResult = {
  materials: MaterialBlend[];
  sizes: ProductSize[];
  careInstructions: string[];
  confidence: ExtractionConfidence;
  warnings: string[];
  model?: string;
};

export type ProductExtractionProvider = {
  extract(input: PageExtractionInput): Promise<AiExtractionResult>;
  /** Reads detail-page images when the text had no blend or size table. Optional: not every provider can see. */
  extractFromImages?(input: ImageExtractionInput): Promise<ImageExtractionResult>;
  isAvailable(): boolean;
  providerName: "unavailable" | "mock" | "gemini";
};

export type AiExtractionResult = {
  product: Partial<ProductFacts>;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  /** The model that actually answered; recorded in metadata, not shown in the UI. */
  model?: string;
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
