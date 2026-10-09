import { describe, expect, it } from "vitest";
import { demoProduct } from "@/data/demoProduct";
import { evaluateMaterials } from "@/domain/materialEvaluation";
import { matchPreferences } from "@/domain/preferenceMatching";
import { calculateCompatibilityScore } from "@/domain/scoring";
import { recommendSize } from "@/domain/sizeRecommendation";
import type { UserPreference, UserProfile } from "@/types/shopping";

describe("calculateCompatibilityScore", () => {
  it("produces deterministic component scores", () => {
    const profile: UserProfile = {
      gender: "male",
      heightCm: 176,
      weightKg: 72,
      preferredFit: "relaxed",
      chestCm: 98,
      shoulderCm: 46,
    };
    const preferences: UserPreference[] = [
      { id: "warmth", weight: 2 },
      { id: "soft_touch", weight: 2 },
      { id: "easy_wash", weight: 1 },
    ];
    const material = evaluateMaterials(demoProduct.materials);
    const preferenceMatches = matchPreferences(preferences, material, demoProduct);
    const size = recommendSize(profile, demoProduct);
    const first = calculateCompatibilityScore({ preferences, preferenceMatches, material, product: demoProduct, size });
    const second = calculateCompatibilityScore({ preferences, preferenceMatches, material, product: demoProduct, size });

    expect(first.total).toBe(second.total);
    expect(first.total).toBeGreaterThan(50);
    expect(first.reasons).toHaveLength(4);
  });
});
