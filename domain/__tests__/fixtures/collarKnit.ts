import { applyBundle, buildPricing } from "@/domain/pricing";
import type { PreferenceId, ProductFacts, UserPreference, UserProfile } from "@/types/shopping";

/**
 * A real production product that produced contradictory results: "[1+1] 더 멋진 카라 니트".
 * Viscose-led blend, hand wash only, dry in shade, sold at a discount with a 1+1 label in the name.
 */
export const collarKnit: ProductFacts = {
  productName: "[1+1] 더 멋진 카라 니트",
  brand: undefined,
  category: "knitwear",
  pricing: buildPricing({ currentPrice: 59900, originalPrice: 69500, currency: "KRW", source: "structured-data", confidence: "high" }),
  images: [],
  description: "카라 디테일의 데일리 니트",
  materials: [
    { name: "Viscose", percentage: 50, source: "page", confidence: "high" },
    { name: "Polyester", percentage: 30, source: "page", confidence: "high" },
    { name: "Nylon", percentage: 20, source: "page", confidence: "high" },
  ],
  sizes: [
    { name: "L", chest: 104, length: 64, unit: "cm" },
    { name: "XL", chest: 112, length: 66, unit: "cm" },
  ],
  careInstructions: ["단독 손세탁", "그늘에 건조", "비틀기 금지", "표백 금지"],
  factsSource: "product_page",
};

/** Same product when the page body states what the 1+1 contains. */
export const collarKnitConfirmedBundle: ProductFacts = {
  ...collarKnit,
  pricing: applyBundle(collarKnit.pricing, collarKnit.productName, "1+1 행사 상품입니다. 2개 구성으로 발송됩니다."),
};

/** Same product when only the name says 1+1. */
export const collarKnitNameOnlyBundle: ProductFacts = {
  ...collarKnit,
  pricing: applyBundle(collarKnit.pricing, collarKnit.productName, "카라 니트 상세 설명"),
};

export const heightWeightProfile: UserProfile = { gender: "male", heightCm: 176, weightKg: 72, preferredFit: "relaxed" };

export const allPreferences: UserPreference[] = (
  [
    "soft_touch",
    "lightweight",
    "warmth",
    "breathability",
    "moisture_wicking",
    "stretch",
    "easy_wash",
    "dryer_friendly",
    "low_pilling",
    "low_wrinkle",
    "long_lasting",
    "natural_materials",
    "value",
  ] as PreferenceId[]
).map((id) => ({ id, weight: 2 as const }));
