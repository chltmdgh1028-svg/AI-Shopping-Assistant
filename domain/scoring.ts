import { calculatePreferenceScore } from "@/domain/preferenceMatching";
import { evaluateProduct, type ProductEvaluation } from "@/domain/evaluation";
import type { CompatibilityScore, MaterialEvaluation, MetricMap, MetricResult, PreferenceMatch, ProductFacts, SizeRecommendation, UserPreference } from "@/types/shopping";

function scoreSize(size: SizeRecommendation) {
  if (size.confidence === "high") return 92;
  if (size.confidence === "medium") return 76;
  if (size.confidence === "low") return 56;
  return 30;
}

type Weighted = Array<{ metric: MetricResult; weight: number }>;

/** Weighted mean over the metrics that could be judged; null when none could. Unavailable ones leave the denominator. */
function weightedMean(entries: Weighted): number | null {
  const usable = entries.filter((entry) => entry.metric.available);
  const weightSum = usable.reduce((sum, entry) => sum + entry.weight, 0);
  if (weightSum === 0) return null;
  return Math.round(usable.reduce((sum, entry) => sum + entry.metric.score * entry.weight, 0) / weightSum);
}

// Care and material fit are read from the same canonical metrics the preference list and the care section use,
// so a label that says "hand wash, dry in shade" cannot be rated "easy care" here and "hard" there.
function scoreCare(metrics: MetricMap): number | null {
  return weightedMean([
    { metric: metrics.washEase, weight: 0.5 },
    { metric: metrics.dryerSafe, weight: 0.3 },
    { metric: metrics.wrinkleResistance, weight: 0.2 },
  ]);
}

function scoreMaterial(metrics: MetricMap): number | null {
  return weightedMean([
    { metric: metrics.durability, weight: 0.26 },
    { metric: metrics.softness, weight: 0.22 },
    { metric: metrics.warmth, weight: 0.2 },
    { metric: metrics.pillingResistance, weight: 0.18 },
    { metric: metrics.breathability, weight: 0.14 },
  ]);
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
  evaluation?: ProductEvaluation;
}): CompatibilityScore {
  const { metrics } = args.evaluation ?? evaluateProduct(args.product);
  const components = {
    preferenceMatch: calculatePreferenceScore(args.preferenceMatches, args.preferences),
    materialMatch: scoreMaterial(metrics),
    sizeConfidence: scoreSize(args.size),
    careCompatibility: scoreCare(metrics),
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
