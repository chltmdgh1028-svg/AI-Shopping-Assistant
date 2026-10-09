import { describe, expect, it } from "vitest";
import { demoProduct } from "@/data/demoProduct";
import { recommendSize } from "@/domain/sizeRecommendation";
import type { UserProfile } from "@/types/shopping";

const profile: UserProfile = {
  gender: "male",
  heightCm: 176,
  weightKg: 72,
  preferredFit: "relaxed",
};

describe("recommendSize", () => {
  it("lowers confidence when only height and weight are present", () => {
    const result = recommendSize(profile, demoProduct);

    expect(result.recommendedSize).toBeTruthy();
    expect(result.confidence).toBe("low");
    expect(result.reason).toContain("키와 몸무게");
  });

  it("does not invent sizes when size chart is missing", () => {
    const result = recommendSize(profile, { ...demoProduct, sizes: [] });

    expect(result.recommendedSize).toBeUndefined();
    expect(result.confidence).toBe("unavailable");
  });

  it("raises confidence when measured body data is present", () => {
    const result = recommendSize({ ...profile, chestCm: 98, shoulderCm: 46 }, demoProduct);

    expect(result.confidence).toBe("high");
  });
});
