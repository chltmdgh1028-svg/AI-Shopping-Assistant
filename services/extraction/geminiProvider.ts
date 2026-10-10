import { ApiError, GoogleGenAI } from "@google/genai";
import type { GeminiConfig } from "@/lib/env";
import {
  ExtractionProviderError,
  type AiExtractionResult,
  type ExtractionErrorCode,
  type ImageExtractionInput,
  type ImageExtractionResult,
  type ImageInput,
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
import { buildVisionPrompt, mapVisionResult, visionResponseJsonSchema, visionResultSchema, visionSystemInstruction } from "@/services/extraction/visionSchema";

// The route allows 60s: link resolution (6s) and the page fetch (8s) come first, so the text chain stays under 28s.
export const GEMINI_ATTEMPT_TIMEOUT_MS = 12_000;
export const GEMINI_TOTAL_BUDGET_MS = 28_000;
// Reading images takes longer than reading text.
export const GEMINI_VISION_ATTEMPT_TIMEOUT_MS = 14_000;
const MIN_ATTEMPT_MS = 1_500;
const maxPageChars = 18_000;

export type GenerateJson = (request: {
  model: string;
  systemInstruction: string;
  prompt: string;
  signal: AbortSignal;
  /** Images to look at, before the prompt. Absent for text requests. */
  images?: ImageInput[];
  /** JSON Schema for the structured answer. Defaults to the product schema. */
  schema?: object;
}) => Promise<string | undefined>;

type Job = {
  systemInstruction: string;
  prompt: string;
  images?: ImageInput[];
  schema?: object;
  attemptTimeoutMs: number;
  totalBudgetMs: number;
};

/** Server-only provider: the API key never leaves this process and is never logged or returned. */
export class GeminiProductExtractionProvider implements ProductExtractionProvider {
  providerName = "gemini" as const;
  private readonly generate: GenerateJson;

  constructor(
    private readonly config: GeminiConfig,
    generate: GenerateJson = createSdkGenerator(config),
    private readonly attemptTimeoutMs = GEMINI_ATTEMPT_TIMEOUT_MS,
    private readonly totalBudgetMs = GEMINI_TOTAL_BUDGET_MS,
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

    const { text, model } = await this.generateWithFallback({
      systemInstruction: geminiSystemInstruction,
      prompt,
      attemptTimeoutMs: this.attemptTimeoutMs,
      totalBudgetMs: this.totalBudgetMs,
    });

    const parsed = parseJson(text);
    const validated = geminiProductSchema.safeParse(parsed);
    if (!validated.success) throw new ExtractionProviderError("invalid_output");

    // Evidence = what the model was shown. A number that is not in it cannot be a fact from this page.
    const evidence = [pageText, input.title, input.metaDescription, input.structuredProduct?.description, summarizeStructured(input.structuredProduct)]
      .filter(Boolean)
      .join(" ");

    return { ...mapGeminiProduct(validated.data, evidence), model };
  }

  /**
   * Reads detail-page images with the same model chain. The result is plausibility-checked rather than checked against
   * text (an image has none), capped at medium confidence, and marked image-vision.
   */
  async extractFromImages(input: ImageExtractionInput): Promise<ImageExtractionResult> {
    const { text, model } = await this.generateWithFallback({
      systemInstruction: visionSystemInstruction,
      prompt: buildVisionPrompt({ url: input.url, imageCount: input.images.length, want: input.want }),
      images: input.images,
      schema: visionResponseJsonSchema,
      attemptTimeoutMs: Math.min(GEMINI_VISION_ATTEMPT_TIMEOUT_MS, input.budgetMs),
      totalBudgetMs: input.budgetMs,
    });

    const validated = visionResultSchema.safeParse(parseJson(text));
    if (!validated.success) throw new ExtractionProviderError("invalid_output");
    return { ...mapVisionResult(validated.data), model };
  }

  /**
   * One attempt per model, in order. Only failures that say "this model is not available right now"
   * move on to the next one; a bad key or a malformed request would fail on every model, so it stops here.
   */
  private async generateWithFallback(job: Job) {
    const deadline = Date.now() + job.totalBudgetMs;
    let last: ExtractionProviderError | undefined;

    for (const model of this.config.models) {
      const remaining = deadline - Date.now();
      if (remaining < MIN_ATTEMPT_MS) break;

      try {
        const text = await this.attempt(model, job, Math.min(job.attemptTimeoutMs, remaining));
        return { text, model };
      } catch (error) {
        if (!(error instanceof AttemptError)) throw error;
        last = error.failure;
        // Model ids are public; the provider's message is never logged because it can echo request details.
        console.warn("Gemini model skipped", { model, code: error.failure.code, status: error.status ?? "none" });
        if (!error.fallback) throw error.failure;
      }
    }

    throw last ?? new ExtractionProviderError("timeout");
  }

  private async attempt(model: string, job: Job, timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const text = await this.generate({
        model,
        systemInstruction: job.systemInstruction,
        prompt: job.prompt,
        images: job.images,
        schema: job.schema,
        signal: controller.signal,
      });
      if (!text) throw new AttemptError(new ExtractionProviderError("invalid_output"), false);
      return text;
    } catch (error) {
      throw error instanceof AttemptError ? error : classify(error, controller.signal.aborted);
    } finally {
      clearTimeout(timer);
    }
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new ExtractionProviderError("invalid_output");
  }
}

class AttemptError extends Error {
  constructor(
    public failure: ExtractionProviderError,
    public fallback: boolean,
    public status?: number,
  ) {
    super(failure.message);
  }
}

function createSdkGenerator(config: GeminiConfig): GenerateJson {
  const client = new GoogleGenAI({ apiKey: config.apiKey });

  return async ({ model, systemInstruction, prompt, signal, images, schema }) => {
    const response = await client.models.generateContent({
      model,
      // Images go first, then the instruction that says what to look for.
      contents: images?.length
        ? [{ role: "user", parts: [...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data } })), { text: prompt }] }]
        : prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: schema ?? geminiResponseJsonSchema,
        abortSignal: signal,
        // The SDK retries 429/5xx with backoff by default. That would burn the per-model budget on one
        // model; the chain is the retry strategy, so each model gets exactly one attempt.
        httpOptions: { retryOptions: { attempts: 1 } },
      },
    });
    return response.text;
  };
}

function classify(error: unknown, aborted: boolean): AttemptError {
  const status = error instanceof ApiError ? error.status : (error as { status?: number } | null)?.status;
  const make = (code: ExtractionErrorCode, fallback: boolean) => new AttemptError(new ExtractionProviderError(code), fallback, status);

  if (aborted) return make("timeout", true);
  if (status === 429) return make("quota", true);

  // Google reports an invalid key as 400 or 403 with "API key" in the message. That never gets better on
  // another model, so it must not trigger a fallback. The message is only inspected, never stored or logged.
  const message = error instanceof Error ? error.message : "";
  if (status === 401 || ((status === 400 || status === 403) && /api key/i.test(message))) return make("auth", false);

  // 404: the model id is unknown or retired. 403 without a key complaint: this account cannot use the model.
  if (status === 404 || status === 403) return make("model", true);
  // 5xx or no status at all (network reset, DNS): temporary, another model may succeed.
  if (status === undefined || status >= 500) return make("upstream", true);

  // Any other 4xx (typically 400) is a request or schema problem of ours, identical on every model.
  return make("upstream", false);
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
