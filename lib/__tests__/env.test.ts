import { describe, expect, it } from "vitest";
import { DEFAULT_GEMINI_MODEL, getGeminiConfig } from "@/lib/env";

describe("getGeminiConfig", () => {
  it("is disabled without a key", () => {
    expect(getGeminiConfig({})).toEqual({ ok: false, reason: "missing_key" });
    expect(getGeminiConfig({ GEMINI_API_KEY: "   " })).toEqual({ ok: false, reason: "missing_key" });
  });

  it("uses the default model when only the key is set", () => {
    expect(getGeminiConfig({ GEMINI_API_KEY: "test-key" })).toEqual({
      ok: true,
      config: { apiKey: "test-key", model: DEFAULT_GEMINI_MODEL },
    });
  });

  it("trims values and honors GEMINI_MODEL, accepting the models/ resource prefix", () => {
    expect(getGeminiConfig({ GEMINI_API_KEY: " test-key ", GEMINI_MODEL: " gemini-3.8-flash " })).toEqual({
      ok: true,
      config: { apiKey: "test-key", model: "gemini-3.8-flash" },
    });
    expect(getGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "models/gemini-3.8-flash" })).toMatchObject({
      ok: true,
      config: { model: "gemini-3.8-flash" },
    });
  });

  it("rejects model names that are not plain model ids", () => {
    expect(getGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini flash; drop" })).toEqual({ ok: false, reason: "invalid_model" });
    expect(getGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "../../etc" })).toEqual({ ok: false, reason: "invalid_model" });
  });
});
