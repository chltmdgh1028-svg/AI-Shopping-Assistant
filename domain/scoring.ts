import { calculatePreferenceScore } from "@/domain/preferenceMatching";
import type { CompatibilityScore, MaterialEvaluation, PreferenceMatch, ProductFacts, SizeRecommendation, UserPreference } from "@/types/shopping";

function scoreSize(size: SizeRecommendation) {
  if (size.confidence === "high") return 92;
  if (size.confidence === "medium") return 76;
  if (size.confidence === "low") return 56;
  return 30;
}

function scoreCare(product: ProductFacts, material: MaterialEvaluation) {
  const base = material.traits.careEase * 18;
  const productCareBonus = product.careInstructions?.length ? 8 : -5;
  return Math.max(20, Math.min(100, base + productCareBonus));
}

function scoreMaterial(material: MaterialEvaluation) {
  const weighted =
    material.traits.warmth * 0.16 +
    material.traits.softness * 0.18 +
    material.traits.durability * 0.22 +
    (6 - material.traits.pillingRisk) * 0.18 +
    material.traits.careEase * 0.14 +
    material.traits.breathability * 0.12;
  return Math.round((weighted / 5) * 100);
}

export function calculateCompatibilityScore(args: {
  preferences: UserPreference[];
  preferenceMatches: PreferenceMatch[];
  material: MaterialEvaluation;
  product: ProductFacts;
  size: SizeRecommendation;
}): CompatibilityScore {
  const preferenceMatch = calculatePreferenceScore(args.preferenceMatches, args.preferences);
  const materialMatch = scoreMaterial(args.material);
  const sizeConfidence = scoreSize(args.size);
  const careCompatibility = scoreCare(args.product, args.material);

  const total = Math.round(
    preferenceMatch * 0.36 +
      materialMatch * 0.26 +
      sizeConfidence * 0.22 +
      careCompatibility * 0.16,
  );

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
    components: { preferenceMatch, materialMatch, sizeConfidence, careCompatibility },
    reasons: [
      `취향 일치도 ${preferenceMatch}%`,
      `소재 적합도 ${materialMatch}%`,
      `사이즈 신뢰도 ${sizeConfidence}%`,
      `관리 적합도 ${careCompatibility}%`,
    ],
  };
}
