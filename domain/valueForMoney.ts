import { baselinePrice, fiberCostFactor, priceRatioCurve } from "@/data/priceReference";
import { materialKnowledge } from "@/data/materials";
import { normalizeMaterialName } from "@/domain/materialEvaluation";
import { readBlend, type MaterialMetricMap } from "@/domain/metrics";
import type { ExtractionConfidence, ProductFacts, ValueEvaluation } from "@/types/shopping";

export const VALUE_CAVEAT =
  "시장 가격 데이터 없이 소재 구성과 가격 구간으로 추정한 참고 값이에요. 브랜드, 봉제 완성도, 원단 등급은 상품 페이지만으로 확인할 수 없어 반영하지 못했어요.";

const LOW_INFO = "가격이나 소재 정보가 부족해 가격 대비 가치를 판단하기 어려워요.";

function unavailable(reason: NonNullable<ValueEvaluation["unavailableReason"]>, summary: string, product: ProductFacts): ValueEvaluation {
  return {
    status: "unavailable",
    unavailableReason: reason,
    label: "판단 어려움",
    summary,
    confidence: "low",
    pricing: product.pricing,
    caveat: VALUE_CAVEAT,
  };
}

function interpolate(ratio: number) {
  const [first] = priceRatioCurve;
  const last = priceRatioCurve[priceRatioCurve.length - 1];
  if (ratio <= first[0]) return first[1];
  if (ratio >= last[0]) return last[1];
  for (let index = 1; index < priceRatioCurve.length; index += 1) {
    const [x1, y1] = priceRatioCurve[index];
    const [x0, y0] = priceRatioCurve[index - 1];
    if (ratio <= x1) return y0 + ((y1 - y0) * (ratio - x0)) / (x1 - x0);
  }
  return last[1];
}

/**
 * "가격 대비 구성": what the page shows (fibers, durability, care) relative to the price the buyer actually
 * pays. It is a reference estimate, not a verdict: with no market-wide data it compares the price to a coarse
 * expectation for this kind of garment and blend, and it says so. The discount never raises the score,
 * because a list price may be inflated; only the current price is judged.
 */
export function evaluateValueForMoney(product: ProductFacts, metrics: MaterialMetricMap): ValueEvaluation {
  const pricing = product.pricing;
  if (!pricing) return unavailable("no_price", LOW_INFO, product);

  const blend = readBlend(product);
  if (blend.knownShare < 0.7) return unavailable("no_materials", LOW_INFO, product);

  const baselines = baselinePrice[pricing.currency];
  if (!baselines) {
    return unavailable("unsupported_currency", `${pricing.currency} 가격은 아직 가격 대비 구성을 평가하지 못해요.`, product);
  }
  if (product.category === "unknown") {
    return unavailable("unknown_category", "상품 종류를 확인하지 못해 가격 대비 구성을 판단하기 어려워요.", product);
  }

  const factor = blend.average((knowledge) => {
    const key = Object.keys(materialKnowledge).find((name) => materialKnowledge[name] === knowledge);
    return (key && fiberCostFactor[key]) || 1;
  });
  if (factor === undefined) return unavailable("no_materials", LOW_INFO, product);

  const expectedPrice = baselines[product.category] * factor;
  const ratio = pricing.currentPrice / expectedPrice;

  // A small nudge from how long the garment should hold up: durable, pill-resistant blends are worth more per won.
  const quality = [metrics.durability, metrics.pillingResistance].filter((metric) => metric.available);
  const qualityAverage = quality.length ? quality.reduce((sum, metric) => sum + metric.score, 0) / quality.length : 60;
  const nudge = Math.max(-5, Math.min(5, Math.round((qualityAverage - 60) / 8)));
  const score = Math.max(0, Math.min(100, Math.round(interpolate(ratio) + nudge)));

  // This is an estimate against reference points, so it is never "high"; weak inputs lower it further.
  const confidence: ExtractionConfidence = pricing.confidence === "low" || blend.knownShare < 0.9 ? "low" : "medium";

  const [label, summary] =
    score >= 72
      ? (["가성비 좋음", "현재 가격을 고려하면 소재 구성과 기능이 괜찮은 편이에요."] as const)
      : score >= 50
        ? (["가성비 보통", "가격 대비 구성은 무난해요."] as const)
        : (["가성비 아쉬움", "가격에 비해 소재 구성은 아쉬울 수 있어요."] as const);

  return { status: "available", score, label, summary, confidence, pricing, expectedPrice: Math.round(expectedPrice), caveat: VALUE_CAVEAT };
}

// Kept for callers that only have the blend name: resolves a fiber name to its knowledge key.
export { normalizeMaterialName };
