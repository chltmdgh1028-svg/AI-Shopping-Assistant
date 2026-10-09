import { describe, expect, it } from "vitest";
import { DEFAULT_GEMINI_MODEL, GEMINI_FALLBACK_MODELS, getGeminiConfig } from "@/lib/env";

describe("getGeminiConfig", () => {
  it("is disabled without a key", () => {
    expect(getGeminiConfig({})).toEqual({ ok: false, reason: "missing_key" });
    expect(getGeminiConfig({ GEMINI_API_KEY: "   " })).toEqual({ ok: false, reason: "missing_key" });
  });

  it("uses the availability-ordered default chain when only the key is set", () => {
    expect(getGeminiConfig({ GEMINI_API_KEY: "test-key" })).toEqual({
      ok: true,
      config: {
        apiKey: "test-key",
        models: [
          "gemini-3.5-flash-lite",
          "gemini-3.1-flash-lite",
          "gemini-3.5-flash",
          "gemini-3.8-flash",
          "gemini-3-flash-preview",
          "gemini-2.5-flash-lite",
          "gemini-2.5-flash",
        ],
      },
    });
    expect(DEFAULT_GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
  });

  it("never contains ids that do not exist as text models", () => {
    const { config } = getGeminiConfig({ GEMINI_API_KEY: "k" }) as { config: { models: string[] } };
    expect(config.models).not.toContain("gemini-3.1-flash");
    expect(config.models).not.toContain("gemini-3-flash");
  });

  it("puts GEMINI_MODEL first without duplicating it in the chain", () => {
    const same = getGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-3.5-flash-lite" });
    expect(same.ok && same.config.models).toHaveLength(1 + GEMINI_FALLBACK_MODELS.length);

    const flash = getGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini-3.5-flash" });
    expect(flash.ok && flash.config.models.slice(0, 3)).toEqual(["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
    expect(flash.ok && new Set(flash.config.models).size).toBe(flash.ok && flash.config.models.length);
  });

  it("trims values and honors GEMINI_MODEL, accepting the models/ resource prefix", () => {
    const trimmed = getGeminiConfig({ GEMINI_API_KEY: " test-key ", GEMINI_MODEL: " gemini-3.8-flash " });
    expect(trimmed.ok && trimmed.config.apiKey).toBe("test-key");
    expect(trimmed.ok && trimmed.config.models[0]).toBe("gemini-3.8-flash");
    const prefixed = getGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "models/gemini-3.8-flash" });
    expect(prefixed.ok && prefixed.config.models[0]).toBe("gemini-3.8-flash");
  });

  it("rejects model names that are not plain model ids", () => {
    expect(getGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "gemini flash; drop" })).toEqual({ ok: false, reason: "invalid_model" });
    expect(getGeminiConfig({ GEMINI_API_KEY: "k", GEMINI_MODEL: "../../etc" })).toEqual({ ok: false, reason: "invalid_model" });
  });
});
