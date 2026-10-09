import { preferenceDefinitions, type PreferenceDefinition } from "@/data/preferences";
import { evaluateProduct, type ProductEvaluation } from "@/domain/evaluation";
import { tierReason } from "@/domain/metricCopy";
import type { MaterialEvaluation, MetricResult, PreferenceMatch, ProductFacts, UserPreference } from "@/types/shopping";

function ratingFromScore(score: number): Exclude<PreferenceMatch["rating"], "unavailable"> {
  if (score >= 82) return "excellent";
  if (score >= 68) return "good";
  if (score >= 48) return "fair";
  return "poor";
}

// How much a match counts toward the preference score. A rough estimate counts for less than a firm fact.
const confidenceWeight = { high: 1, medium: 1, low: 0.6 } as const;

function buildReason(definition: PreferenceDefinition, metric: MetricResult, evaluation: ProductEvaluation) {
  if (definition.metric === "valueForMoney") return evaluation.value.summary;
  // The metric already explains itself for this product; the preference list repeats that, never re-derives it.
  return metric.reason ?? tierReason(definition.metric, metric.score);
}

function unavailableReason(definition: PreferenceDefinition, metric: MetricResult, evaluation: ProductEvaluation) {
  if (definition.metric === "valueForMoney") return evaluation.value.summary;
  return metric.reason && metric.reason !== "" ? metric.reason : "상품 페이지에서 확인할 수 있는 정보가 부족해 판단하지 않았어요.";
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
    const shared = { preferenceId: preference.id, label: definition.label, metric: definition.metric, confidence: metric.confidence, basis: metric.basis, source: metric.source };

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
