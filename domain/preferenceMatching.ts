import { preferenceDefinitions, type PreferenceDefinition } from "@/data/preferences";
import { evaluateProduct, type ProductEvaluation } from "@/domain/evaluation";
import type { MaterialEvaluation, MetricKey, MetricResult, PreferenceMatch, ProductFacts, UserPreference } from "@/types/shopping";

function ratingFromScore(score: number): Exclude<PreferenceMatch["rating"], "unavailable"> {
  if (score >= 82) return "excellent";
  if (score >= 68) return "good";
  if (score >= 48) return "fair";
  return "poor";
}

// How much a match counts toward the preference score. A rough estimate counts for less than a firm fact.
const confidenceWeight = { high: 1, medium: 1, low: 0.6 } as const;

const reasonCopy: Record<Exclude<MetricKey, "valueForMoney">, { good: string; fair: string; poor: string }> = {
  softness: {
    good: "소재 구성상 부드럽게 느껴질 가능성이 높아요.",
    fair: "촉감은 제품에 따라 차이가 있어 무난한 편이에요.",
    poor: "소재 구성상 까슬거리거나 피부에 거슬릴 수 있어요.",
  },
  lightweight: {
    good: "가벼운 소재 위주라 오래 입어도 부담이 적어요.",
    fair: "무게감은 보통 수준이에요.",
    poor: "소재 구성상 묵직하게 느껴질 수 있어요.",
  },
  warmth: {
    good: "보온성이 좋은 소재 구성이에요.",
    fair: "보온성은 보통 수준이에요.",
    poor: "추운 날 입기엔 보온성이 아쉬울 수 있어요.",
  },
  breathability: {
    good: "공기가 잘 통하는 소재 구성이에요.",
    fair: "통기성은 보통 수준이에요.",
    poor: "소재 구성상 다소 답답하게 느껴질 수 있어요.",
  },
  moistureWicking: {
    good: "땀을 빠르게 흡수하고 말리는 소재 구성이에요.",
    fair: "땀 배출과 건조 속도는 보통 수준이에요.",
    poor: "땀이 차면 잘 마르지 않을 수 있어요.",
  },
  stretch: {
    good: "잘 늘어나서 움직일 때 편안해요.",
    fair: "신축성은 약간 있는 정도예요.",
    poor: "신축성은 크게 기대하기 어려워요.",
  },
  washEase: {
    good: "집에서 세탁하기 쉬운 편이에요.",
    fair: "세탁할 때 약간의 주의가 필요해요.",
    poor: "세탁이 까다로워 관리에 신경이 필요해요.",
  },
  dryerSafe: {
    good: "건조기를 사용할 수 있는 편이에요.",
    fair: "건조기는 낮은 온도에서만 쓰는 편이 안전해요.",
    poor: "건조기는 사용하지 않는 편이 좋아요.",
  },
  pillingResistance: {
    good: "보풀이 잘 생기지 않는 편이에요.",
    fair: "마찰이 많은 부위에 보풀이 생길 수 있어요.",
    poor: "보풀이 생기기 쉬운 소재 구성이에요.",
  },
  wrinkleResistance: {
    good: "구김이 적은 편이에요.",
    fair: "구김이 약간 생길 수 있어요.",
    poor: "구김이 쉽게 생겨 다림질이 필요할 수 있어요.",
  },
  durability: {
    good: "튼튼한 소재 구성이라 오래 입기 좋아요.",
    fair: "내구성은 보통 수준이에요.",
    poor: "마모나 늘어짐에 약할 수 있어요.",
  },
  naturalFiberRatio: {
    good: "천연 섬유 비중이 높아요.",
    fair: "천연 섬유와 합성 섬유가 섞여 있어요.",
    poor: "합성 섬유 위주예요.",
  },
};

function tier(score: number): "good" | "fair" | "poor" {
  return score >= 68 ? "good" : score >= 48 ? "fair" : "poor";
}

function buildReason(definition: PreferenceDefinition, metric: MetricResult, evaluation: ProductEvaluation) {
  if (definition.metric === "valueForMoney") return evaluation.value.summary;
  const copy = reasonCopy[definition.metric][tier(metric.score)];
  return metric.note ? `${copy} ${metric.note}` : copy;
}

function unavailableReason(definition: PreferenceDefinition, metric: MetricResult, evaluation: ProductEvaluation) {
  if (definition.metric === "valueForMoney") return evaluation.value.summary;
  return "상품 페이지에서 확인할 수 있는 정보가 부족해 판단하지 않았어요.";
}

/**
 * One match per selected preference, each judged by its own metric. Preferences the page cannot answer are
 * marked unavailable instead of getting a made-up middle score.
 */
export function matchPreferences(
  preferences: UserPreference[],
  _material: MaterialEvaluation,
  product: ProductFacts,
  evaluation: ProductEvaluation = evaluateProduct(product),
): PreferenceMatch[] {
  return preferences.flatMap((preference): PreferenceMatch[] => {
    const definition = preferenceDefinitions.find((item) => item.id === preference.id);
    if (!definition) return []; // an id that no longer exists must not break the analysis

    const metric = evaluation.metrics[definition.metric];
    const shared = { preferenceId: preference.id, label: definition.label, metric: definition.metric, confidence: metric.confidence, basis: metric.basis };

    if (!metric.available) {
      return [{ ...shared, rating: "unavailable" as const, score: 0, available: false, reason: unavailableReason(definition, metric, evaluation) }];
    }
    return [{ ...shared, rating: ratingFromScore(metric.score), score: metric.score, available: true, reason: buildReason(definition, metric, evaluation) }];
  });
}

/** Weighted average over matches that could be judged. null when none could: the caller leaves it out of the total. */
export function calculatePreferenceScore(matches: PreferenceMatch[], preferences: UserPreference[]): number | null {
  let weightSum = 0;
  let scoreSum = 0;

  for (const match of matches) {
    if (match.available === false || match.rating === "unavailable") continue;
    const userWeight = preferences.find((preference) => preference.id === match.preferenceId)?.weight ?? 1;
    const weight = userWeight * confidenceWeight[match.confidence ?? "medium"];
    weightSum += weight;
    scoreSum += match.score * weight;
  }

  return weightSum > 0 ? Math.round(scoreSum / weightSum) : null;
}
