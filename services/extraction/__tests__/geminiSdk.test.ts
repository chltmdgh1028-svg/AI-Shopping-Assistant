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
    const provider = new GeminiProductExtractionProvider({ apiKey: "test-key-not-real", model: "gemini-test-model" });
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
    const provider = new GeminiProductExtractionProvider({ apiKey: "test-key-not-real", model: "gemini-test-model" });
    await provider.extract({ url: "https://shop.example.com/a", pageText: "Wool 60%" });
    expect(JSON.stringify(calls[0].request)).not.toContain("test-key-not-real");
  });
});
