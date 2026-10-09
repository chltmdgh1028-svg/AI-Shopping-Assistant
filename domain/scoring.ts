import { calculatePreferenceScore } from "@/domain/preferenceMatching";
import type { CompatibilityScore, MaterialEvaluation, PreferenceMatch, ProductFacts, SizeRecommendation, UserPreference } from "@/types/shopping";

function scoreSize(size: SizeRecommendation) {
  if (size.confidence === "high") return 92;
  if (size.confidence === "medium") return 76;
  if (size.confidence === "low") return 56;
  return 30;
}

function hasMaterials(material: MaterialEvaluation) {
  return material.materialNotes.length > 0;
}

function scoreCare(product: ProductFacts, material: MaterialEvaluation): number | null {
  // Neither a blend nor a care label: nothing to judge, so leave it out instead of scoring a default.
  if (!hasMaterials(material) && !product.careInstructions?.length) return null;
  const base = material.traits.careEase * 18;
  const productCareBonus = product.careInstructions?.length ? 8 : -5;
  return Math.max(20, Math.min(100, base + productCareBonus));
}

function scoreMaterial(material: MaterialEvaluation): number | null {
  if (!hasMaterials(material)) return null;
  const weighted =
    material.traits.warmth * 0.16 +
    material.traits.softness * 0.18 +
    material.traits.durability * 0.22 +
    (6 - material.traits.pillingRisk) * 0.18 +
    material.traits.careEase * 0.14 +
    material.traits.breathability * 0.12;
  return Math.round((weighted / 5) * 100);
}

const componentWeights = { preferenceMatch: 0.36, materialMatch: 0.26, sizeConfidence: 0.22, careCompatibility: 0.16 } as const;

const componentLabels = {
  preferenceMatch: "취향 일치도",
  materialMatch: "소재 적합도",
  sizeConfidence: "사이즈 신뢰도",
  careCompatibility: "관리 적합도",
} as const;

/**
 * The total is a weighted average over the components that could be judged. A component with no data is
 * dropped from numerator and denominator, so missing information neither drags the score down nor lifts it.
 * Price only enters through the "가성비" preference, and only when the user selected it.
 */
export function calculateCompatibilityScore(args: {
  preferences: UserPreference[];
  preferenceMatches: PreferenceMatch[];
  material: MaterialEvaluation;
  product: ProductFacts;
  size: SizeRecommendation;
}): CompatibilityScore {
  const components = {
    preferenceMatch: calculatePreferenceScore(args.preferenceMatches, args.preferences),
    materialMatch: scoreMaterial(args.material),
    sizeConfidence: scoreSize(args.size),
    careCompatibility: scoreCare(args.product, args.material),
  };

  const entries = (Object.keys(componentWeights) as Array<keyof typeof componentWeights>).flatMap((key) => {
    const value = components[key];
    return value === null ? [] : [{ key, value, weight: componentWeights[key] }];
  });
  const weightSum = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const total = Math.round(entries.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weightSum);

  const verdict = total >= 82 ? "추천해요" : total >= 66 ? "조건부 추천" : "신중히 추천";
  const summary =
    total >= 82
      ? "당신의 취향과 사이즈 조건에 전반적으로 잘 맞는 옷입니다."
      : total >= 66
        ? "좋은 점이 있지만 관리나 사이즈 정보는 한 번 더 확인하면 좋아요."
        : "취향 또는 정보 신뢰도 측면에서 아쉬운 부분이 있어 신중히 보는 편이 좋아요.";

  return {
    total,
    verdict,
    summary,
    components,
    reasons: (Object.keys(componentLabels) as Array<keyof typeof componentLabels>).map((key) =>
      components[key] === null ? `${componentLabels[key]}: 판단할 정보가 부족해 점수에서 제외했어요` : `${componentLabels[key]} ${components[key]}%`,
    ),
  };
}
