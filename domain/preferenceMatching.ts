import { preferenceDefinitions } from "@/data/preferences";
import type { MaterialEvaluation, PreferenceId, PreferenceMatch, ProductFacts, UserPreference } from "@/types/shopping";

const preferenceTraitMap: Record<PreferenceId, { trait: keyof MaterialEvaluation["traits"]; reverse?: boolean }> = {
  soft_touch: { trait: "softness" },
  avoid_itchy: { trait: "softness" },
  lightweight: { trait: "weight" },
  warmth: { trait: "warmth" },
  breathability: { trait: "breathability" },
  moisture_wicking: { trait: "breathability" },
  stretch: { trait: "stretch" },
  easy_wash: { trait: "careEase" },
  dryer_friendly: { trait: "careEase" },
  low_pilling: { trait: "pillingRisk", reverse: true },
  low_wrinkle: { trait: "careEase" },
  value: { trait: "durability" },
  long_lasting: { trait: "durability" },
  natural_materials: { trait: "naturalness" },
  quality_first: { trait: "durability" },
};

function ratingFromScore(score: number): PreferenceMatch["rating"] {
  if (score >= 82) return "excellent";
  if (score >= 68) return "good";
  if (score >= 48) return "fair";
  return "poor";
}

export function matchPreferences(
  preferences: UserPreference[],
  material: MaterialEvaluation,
  product: ProductFacts,
): PreferenceMatch[] {
  return preferences.map((preference) => {
    const definition = preferenceDefinitions.find((item) => item.id === preference.id);
    const mapping = preferenceTraitMap[preference.id];
    const rawTrait = material.traits[mapping.trait];
    const traitScore = mapping.reverse ? 6 - rawTrait : rawTrait;
    let score = Math.round((traitScore / 5) * 100);

    if (preference.id === "dryer_friendly") {
      const dryerMentioned = product.careInstructions?.some((item) => item.includes("건조기") || item.toLowerCase().includes("dryer"));
      score = dryerMentioned ? Math.min(score, 78) : Math.min(score, 45);
    }

    return {
      preferenceId: preference.id,
      label: definition?.label ?? preference.id,
      rating: ratingFromScore(score),
      score,
      reason: buildPreferenceReason(preference.id, score, product),
    };
  });
}

function buildPreferenceReason(preferenceId: PreferenceId, score: number, product: ProductFacts) {
  const sourcePrefix = product.factsSource === "demo" ? "샘플 상품 정보와 소재 특성을 함께 보면" : "상품 정보와 소재 특성을 함께 보면";
  if (score >= 82) return `${sourcePrefix} 이 조건에 꽤 잘 맞아요.`;
  if (score >= 68) return `${sourcePrefix} 전반적으로 무난하게 맞아요.`;
  if (score >= 48) return `${sourcePrefix} 큰 문제는 아니지만 기대보다 덜 맞을 수 있어요.`;
  if (preferenceId === "dryer_friendly") return "제조사 건조기 가능 정보가 없어 건조기 사용은 권하지 않았어요.";
  return `${sourcePrefix} 이 조건은 아쉬울 가능성이 있어요.`;
}

export function calculatePreferenceScore(matches: PreferenceMatch[], preferences: UserPreference[]) {
  if (matches.length === 0) return 70;
  const totalWeight = preferences.reduce((sum, preference) => sum + preference.weight, 0);
  const weighted = matches.reduce((sum, match) => {
    const weight = preferences.find((preference) => preference.id === match.preferenceId)?.weight ?? 1;
    return sum + match.score * weight;
  }, 0);
  return Math.round(weighted / totalWeight);
}
