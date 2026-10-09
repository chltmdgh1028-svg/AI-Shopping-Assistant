import { materialKnowledge } from "@/data/materials";
import type { MaterialBlend, MaterialEvaluation, MaterialTrait, TraitScore } from "@/types/shopping";

const defaultTraits: Record<MaterialTrait, TraitScore> = {
  warmth: 3,
  softness: 3,
  breathability: 3,
  durability: 3,
  pillingRisk: 3,
  careEase: 3,
  stretch: 2,
  weight: 3,
  naturalness: 2,
};

export function normalizeMaterialName(name: string) {
  const lower = name.trim().toLowerCase();
  // The longest matching alias wins, so "폴리우레탄" is spandex and not polyester ("폴리").
  let best: { key: string; length: number } | undefined;
  for (const [key, knowledge] of Object.entries(materialKnowledge)) {
    for (const alias of knowledge.aliases) {
      if (lower.includes(alias.toLowerCase()) && (!best || alias.length > best.length)) best = { key, length: alias.length };
    }
  }
  return best?.key ?? lower;
}

function clampTrait(value: number): TraitScore {
  return Math.max(1, Math.min(5, Math.round(value))) as TraitScore;
}

export function evaluateMaterials(materials: MaterialBlend[]): MaterialEvaluation {
  if (materials.length === 0) {
    return {
      blendSummary: "소재 정보가 없어 일반적인 평가를 할 수 없습니다.",
      traits: defaultTraits,
      materialNotes: [],
      assumptions: ["상품 페이지에서 소재 혼용률을 확인하지 못했습니다."],
    };
  }

  const totalPercentage = materials.reduce((sum, material) => sum + material.percentage, 0) || 100;
  const weightedTraits = Object.keys(defaultTraits).reduce(
    (acc, trait) => ({ ...acc, [trait]: 0 }),
    {} as Record<MaterialTrait, number>,
  );
  const assumptions: string[] = [];

  const materialNotes = materials.map((material) => {
    const key = normalizeMaterialName(material.name);
    const knowledge = materialKnowledge[key];
    const traits = knowledge?.traits ?? defaultTraits;
    const weight = material.percentage / totalPercentage;

    (Object.keys(weightedTraits) as MaterialTrait[]).forEach((trait) => {
      weightedTraits[trait] += traits[trait] * weight;
    });

    if (!knowledge) {
      assumptions.push(`${material.name} 소재 지식이 제한되어 중간값으로 평가했습니다.`);
    }

    return {
      name: material.name,
      percentage: material.percentage,
      pros: knowledge?.pros ?? ["상품 상세 정보가 더 있으면 장점을 더 정확히 판단할 수 있어요."],
      cons: knowledge?.cons ?? ["소재 특성이 확인되지 않아 단정하지 않았어요."],
    };
  });

  const traits = (Object.keys(weightedTraits) as MaterialTrait[]).reduce(
    (acc, trait) => ({ ...acc, [trait]: clampTrait(weightedTraits[trait]) }),
    {} as Record<MaterialTrait, TraitScore>,
  );

  const blendSummary = materials.map((material) => `${material.name} ${material.percentage}%`).join(" / ");

  return {
    blendSummary,
    traits,
    materialNotes,
    assumptions,
  };
}

export function traitToLabel(score: TraitScore, reverse = false) {
  const adjusted = reverse ? 6 - score : score;
  if (adjusted >= 5) return "매우 적합";
  if (adjusted >= 4) return "적합";
  if (adjusted >= 3) return "보통";
  if (adjusted >= 2) return "아쉬움";
  return "맞지 않음";
}
