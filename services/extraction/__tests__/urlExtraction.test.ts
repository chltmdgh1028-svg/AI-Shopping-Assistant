import { describe, expect, it } from "vitest";
import { UnavailableProductExtractionProvider } from "@/services/extraction/aiProvider";

describe("AI extraction provider fallback", () => {
  it("is unavailable without environment configuration and returns no invented facts", async () => {
    const provider = new UnavailableProductExtractionProvider();

    expect(provider.isAvailable()).toBe(false);
    await expect(provider.extract()).resolves.toEqual({});
  });
});
