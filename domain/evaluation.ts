import { evaluateMaterialMetrics } from "@/domain/metrics";
import { evaluateValueForMoney } from "@/domain/valueForMoney";
import type { MetricMap, ProductFacts, ValueEvaluation } from "@/types/shopping";

export type ProductEvaluation = { metrics: MetricMap; value: ValueEvaluation };

/**
 * All 13 metrics for a product. Twelve come from the fibers and care label; valueForMoney is its own
 * evaluation that needs a price. No metric is derived from another, so choosing two preferences never
 * counts the same fact twice.
 */
export function evaluateProduct(product: ProductFacts): ProductEvaluation {
  const materialMetrics = evaluateMaterialMetrics(product);
  const value = evaluateValueForMoney(product, materialMetrics);

  return {
    metrics: {
      ...materialMetrics,
      valueForMoney:
        value.status === "available" && value.score !== undefined
          ? { available: true, score: value.score, confidence: value.confidence, basis: "price_and_material", note: value.summary }
          : { available: false, score: 0, confidence: "low", basis: "price_and_material", note: value.summary },
    },
    value,
  };
}
