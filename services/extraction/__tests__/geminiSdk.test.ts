// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// The real SDK is replaced so the test sees exactly what the provider hands to it.
const calls: Array<{ constructorArgs: unknown; request: Record<string, unknown> }> = [];

vi.mock("@google/genai", () => {
  class ApiError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  }
  class GoogleGenAI {
    constructor(public args: unknown) {}
    models = {
      generateContent: async (request: Record<string, unknown>) => {
        calls.push({ constructorArgs: this.args, request });
        return { text: JSON.stringify({ productName: null, brand: null, category: "unknown", currentPrice: null, originalPrice: null, currency: null, description: null, materials: [], sizes: [], fit: "unknown", careInstructions: [], extractionConfidence: "low" }) };
      },
    };
  }
  return { ApiError, GoogleGenAI };
});

import { GeminiProductExtractionProvider } from "@/services/extraction/geminiProvider";

describe("Gemini SDK call", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("uses the configured key and model, structured JSON output, and a single attempt", async () => {
    const provider = new GeminiProductExtractionProvider({ apiKey: "test-key-not-real", models: ["gemini-test-model"] });
    await provider.extract({ url: "https://shop.example.com/a", pageText: "Wool 60%" });

    expect(calls).toHaveLength(1);
    expect(calls[0].constructorArgs).toEqual({ apiKey: "test-key-not-real" });
    const { request } = calls[0];
    expect(request.model).toBe("gemini-test-model");

    const config = request.config as Record<string, unknown>;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseJsonSchema).toBeDefined();
    expect(config.abortSignal).toBeInstanceOf(AbortSignal);
    // Retrying inside the 20s budget would hide a quota error as a timeout.
    expect(config.httpOptions).toEqual({ retryOptions: { attempts: 1 } });
  });

  it("never puts the key in the prompt sent to the model", async () => {
    const provider = new GeminiProductExtractionProvider({ apiKey: "test-key-not-real", models: ["gemini-test-model"] });
    await provider.extract({ url: "https://shop.example.com/a", pageText: "Wool 60%" });
    expect(JSON.stringify(calls[0].request)).not.toContain("test-key-not-real");
  });

  it("sends images as inline parts before the instruction, with the vision schema", async () => {
    const provider = new GeminiProductExtractionProvider({ apiKey: "test-key-not-real", models: ["gemini-test-model"] });
    // The mocked SDK answers with a product-shaped JSON, which the vision schema rejects: only the request matters here.
    await provider
      .extractFromImages({ url: "https://zigzag.kr/p/1", images: [{ mimeType: "image/jpeg", data: "AAAA" }], labels: ["17-2"], want: ["materials"], budgetMs: 10_000 })
      .catch(() => undefined);

    const { request } = calls[0];
    const contents = request.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    expect(contents[0].role).toBe("user");
    // Each image is introduced by its label, so the answer can say which one it read.
    expect(contents[0].parts[0]).toEqual({ text: "Image 17-2:" });
    expect(contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "AAAA" } });
    expect(typeof contents[0].parts.at(-1)?.text).toBe("string");
    expect((request.config as Record<string, unknown>).responseJsonSchema).toMatchObject({ required: expect.arrayContaining(["readability"]) });
    expect(JSON.stringify(request)).not.toContain("test-key-not-real");
  });
});
