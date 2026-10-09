import { describe, expect, it } from "vitest";
import { demoProduct } from "@/data/demoProduct";
import { evaluateMaterials } from "@/domain/materialEvaluation";
import { calculatePreferenceScore, matchPreferences } from "@/domain/preferenceMatching";
import type { UserPreference } from "@/types/shopping";

describe("matchPreferences", () => {
  it("maps user preferences to explainable scores", () => {
    const material = evaluateMaterials(demoProduct.materials);
    const preferences: UserPreference[] = [
      { id: "warmth", weight: 2 as const },
      { id: "low_pilling", weight: 2 as const },
    ];
    const matches = matchPreferences(preferences, material, demoProduct);

    expect(matches).toHaveLength(2);
    expect(matches[0].reason).toBeTruthy();
    expect(calculatePreferenceScore(matches, preferences)).toBeGreaterThan(0);
  });
});
