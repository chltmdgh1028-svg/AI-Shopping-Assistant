import { ApiError, GoogleGenAI } from "@google/genai";
import type { GeminiConfig } from "@/lib/env";
import {
  ExtractionProviderError,
  type AiExtractionResult,
  type PageExtractionInput,
  type ProductExtractionProvider,
} from "@/services/extraction/aiProvider";
import {
  buildGeminiPrompt,
  geminiProductSchema,
  geminiResponseJsonSchema,
  geminiSystemInstruction,
  mapGeminiProduct,
} from "@/services/extraction/geminiSchema";

export const GEMINI_TIMEOUT_MS = 20_000;
const maxPageChars = 18_000;

export type GenerateJson = (request: { systemInstruction: string; prompt: string; signal: AbortSignal }) => Promise<string | undefined>;

/** Server-only provider: the API key never leaves this process and is never logged or returned. */
export class GeminiProductExtractionProvider implements ProductExtractionProvider {
  providerName = "gemini" as const;
  private readonly generate: GenerateJson;

  constructor(
    config: GeminiConfig,
    generate: GenerateJson = createSdkGenerator(config),
    private readonly timeoutMs = GEMINI_TIMEOUT_MS,
  ) {
    this.generate = generate;
  }

  isAvailable() {
    return true;
  }

  async extract(input: PageExtractionInput): Promise<AiExtractionResult> {
    const pageText = input.pageText.slice(0, maxPageChars);
    const prompt = buildGeminiPrompt({
      url: input.url,
      title: input.title,
      metaDescription: input.metaDescription,
      pageText,
      structuredHint: summarizeStructured(input.structuredProduct),
    });

    const text = await this.generateWithTimeout(prompt);

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ExtractionProviderError("invalid_output");
    }

    const validated = geminiProductSchema.safeParse(parsed);
    if (!validated.success) throw new ExtractionProviderError("invalid_output");

    // Evidence = what the model was shown. A number that is not in it cannot be a fact from this page.
    const evidence = [pageText, input.title, input.metaDescription, input.structuredProduct?.description, summarizeStructured(input.structuredProduct)]
      .filter(Boolean)
      .join(" ");

    return mapGeminiProduct(validated.data, evidence);
  }

  private async generateWithTimeout(prompt: string) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const text = await this.generate({ systemInstruction: geminiSystemInstruction, prompt, signal: controller.signal });
      if (!text) throw new ExtractionProviderError("invalid_output");
      return text;
    } catch (error) {
      throw toProviderError(error, controller.signal.aborted);
    } finally {
      clearTimeout(timer);
    }
  }
}

function createSdkGenerator(config: GeminiConfig): GenerateJson {
  const client = new GoogleGenAI({ apiKey: config.apiKey });

  return async ({ systemInstruction, prompt, signal }) => {
    const response = await client.models.generateContent({
      model: config.model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: geminiResponseJsonSchema,
        abortSignal: signal,
        // The SDK retries 429/5xx with backoff by default. Inside our 20s budget that turns a quota error
        // into a silent timeout, so we make one attempt and report the real failure class instead.
        httpOptions: { retryOptions: { attempts: 1 } },
      },
    });
    return response.text;
  };
}

function toProviderError(error: unknown, aborted: boolean): ExtractionProviderError {
  if (error instanceof ExtractionProviderError) return error;

  const status = error instanceof ApiError ? error.status : (error as { status?: number } | null)?.status;
  if (aborted) {
    // Only the class of failure is logged: provider messages can echo request details.
    console.error("Gemini extraction timed out", { status: status ?? "none" });
    return new ExtractionProviderError("timeout");
  }
  if (status === 429) return new ExtractionProviderError("quota");
  if (status === 401 || status === 403) return new ExtractionProviderError("auth");
  if (status === 404) return new ExtractionProviderError("model");

  // Log only the class of failure: provider messages can echo request details.
  console.error("Gemini extraction failed", { status: status ?? "none" });
  return new ExtractionProviderError("upstream");
}

function summarizeStructured(product?: PageExtractionInput["structuredProduct"]) {
  if (!product) return undefined;
  const summary = {
    name: product.productName,
    brand: product.brand,
    price: product.price,
    currency: product.currency,
    description: product.description?.slice(0, 600),
    materials: product.materials?.map((item) => `${item.name} ${item.percentage}%`),
  };
  return JSON.stringify(summary);
}
