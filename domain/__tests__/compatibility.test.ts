import { describe, expect, it } from "vitest";
import { demoProduct } from "@/data/demoProduct";
import { evaluateMaterials } from "@/domain/materialEvaluation";
import { calculatePreferenceScore, matchPreferences } from "@/domain/preferenceMatching";
import { buildPricing } from "@/domain/pricing";
import { calculateCompatibilityScore } from "@/domain/scoring";
import { recommendSize } from "@/domain/sizeRecommendation";
import type { PreferenceId, ProductFacts, UserPreference, UserProfile } from "@/types/shopping";

const profile: UserProfile = { gender: "male", heightCm: 176, weightKg: 72, preferredFit: "relaxed", chestCm: 98, shoulderCm: 46 };

const prefs = (...ids: PreferenceId[]): UserPreference[] => ids.map((id) => ({ id, weight: 2 as const }));

function score(preferences: UserPreference[], product: ProductFacts = demoProduct) {
  const material = evaluateMaterials(product.materials);
  const preferenceMatches = matchPreferences(preferences, material, product);
  const size = recommendSize(profile, product);
  return { preferenceMatches, result: calculateCompatibilityScore({ preferences, preferenceMatches, material, product, size }) };
}

const withoutPrice = { ...demoProduct, pricing: undefined, price: undefined };
const withPrice = (currentPrice: number): ProductFacts => ({
  ...demoProduct,
  pricing: buildPricing({ currentPrice, currency: "KRW", source: "structured-data", confidence: "high" }),
});

describe("price only matters to users who chose 가성비", () => {
  const without = ["warmth", "soft_touch", "easy_wash"] as PreferenceId[];

  it("leaves the total untouched when 가성비 is not selected, whatever the price", () => {
    const baseline = score(prefs(...without), withoutPrice).result.total;
    expect(score(prefs(...without), withPrice(20000)).result.total).toBe(baseline);
    expect(score(prefs(...without), withPrice(900000)).result.total).toBe(baseline);
    expect(score(prefs(...without), demoProduct).result.total).toBe(baseline);
  });

  it("lets the price move the total when 가성비 is selected", () => {
    const cheap = score(prefs(...without, "value"), withPrice(49000)).result.total;
    const dear = score(prefs(...without, "value"), withPrice(220000)).result.total;
    expect(cheap).toBeGreaterThan(dear);
  });

  it("weights 가성비 like any other preference the user picked", () => {
    const light = score([...prefs("warmth"), { id: "value", weight: 1 }], withPrice(220000)).result.components.preferenceMatch!;
    const heavy = score([...prefs("warmth"), { id: "value", weight: 3 }], withPrice(220000)).result.components.preferenceMatch!;
    // 가성비 is the poor match here, so giving it more weight pulls the preference score down.
    expect(heavy).toBeLessThan(light);
  });
});

describe("missing information does not distort the score", () => {
  it("marks an unanswerable preference unavailable instead of inventing a middle score", () => {
    const { preferenceMatches } = score(prefs("warmth", "value"), withoutPrice);
    const value = preferenceMatches.find((match) => match.preferenceId === "value")!;
    expect(value.available).toBe(false);
    expect(value.rating).toBe("unavailable");
    expect(value.reason).toBe("가격이나 소재 정보가 부족해 가격 대비 가치를 판단하기 어려워요.");
  });

  it("drops an unavailable preference from the average (same as not choosing it)", () => {
    const withUnavailable = score(prefs("warmth", "soft_touch", "value"), withoutPrice);
    const withoutIt = score(prefs("warmth", "soft_touch"), withoutPrice);
    expect(withUnavailable.result.components.preferenceMatch).toBe(withoutIt.result.components.preferenceMatch);
    expect(withUnavailable.result.total).toBe(withoutIt.result.total);
  });

  it("does not let a low-information match count as much as a firm one", () => {
    const matches = score(prefs("warmth", "dryer_friendly")).preferenceMatches;
    const dryer = matches.find((match) => match.preferenceId === "dryer_friendly")!;
    const warmth = matches.find((match) => match.preferenceId === "warmth")!;
    expect(dryer.confidence).toBe("high"); // the sample's care label says no dryer
    expect(warmth.confidence).toBe("medium");
    expect(calculatePreferenceScore(matches, prefs("warmth", "dryer_friendly"))).not.toBeNull();
  });

  it("returns no preference score when nothing selected could be judged, and keeps the total honest", () => {
    const bare: ProductFacts = { ...demoProduct, materials: [], careInstructions: undefined, pricing: undefined, sizes: [] };
    const { preferenceMatches, result } = score(prefs("warmth", "soft_touch", "value"), bare);
    expect(preferenceMatches.every((match) => match.available === false)).toBe(true);
    expect(calculatePreferenceScore(preferenceMatches, prefs("warmth", "soft_touch", "value"))).toBeNull();
    expect(result.components.preferenceMatch).toBeNull();
    expect(result.components.materialMatch).toBeNull();
    expect(result.components.careCompatibility).toBeNull();
    // Only the size component can speak, and with no size table it says so (a low, honest number).
    expect(result.total).toBe(result.components.sizeConfidence);
    expect(result.reasons.join(" ")).toContain("판단할 정보가 부족");
  });

  it("scores a user with no preferences from the remaining components", () => {
    const { result } = score([]);
    expect(result.components.preferenceMatch).toBeNull();
    expect(result.total).toBeGreaterThan(40);
  });

  it("ignores a preference id that no longer exists", () => {
    const material = evaluateMaterials(demoProduct.materials);
    const matches = matchPreferences([{ id: "avoid_itchy" as PreferenceId, weight: 2 }, ...prefs("warmth")], material, demoProduct);
    expect(matches.map((match) => match.preferenceId)).toEqual(["warmth"]);
  });
});

describe("soft touch counts once", () => {
  it("is a single match for a single preference", () => {
    const matches = score(prefs("soft_touch")).preferenceMatches;
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ preferenceId: "soft_touch", metric: "softness" });
  });
});

describe("regression: the sample product's deterministic result", () => {
  it("keeps the same verdict and components for the original four default preferences", () => {
    const defaults = prefs("warmth", "soft_touch", "low_pilling", "easy_wash");
    const first = score(defaults).result;
    const second = score(defaults).result;
    expect(second).toEqual(first);
    expect(first.total).toBeGreaterThan(55);
    expect(first.total).toBeLessThan(85);
    expect(first.components.sizeConfidence).not.toBeNull();
    expect(first.reasons).toHaveLength(4);
  });

  it("rates the sample's care by its own label: easy wash, no dryer", () => {
    const matches = score(prefs("easy_wash", "dryer_friendly")).preferenceMatches;
    const wash = matches.find((match) => match.preferenceId === "easy_wash")!;
    const dryer = matches.find((match) => match.preferenceId === "dryer_friendly")!;
    expect(wash.basis).toBe("product_page");
    expect(dryer.basis).toBe("product_page");
    expect(dryer.rating).toBe("poor");
    expect(wash.score).toBeGreaterThan(dryer.score);
  });
});
