import { baselinePrice, fiberCostFactor, priceRatioCurve } from "@/data/priceReference";
import { materialKnowledge } from "@/data/materials";
import { normalizeMaterialName } from "@/domain/materialEvaluation";
import { readBlend, type MaterialMetricMap } from "@/domain/metrics";
import { formatPriceLabel } from "@/domain/pricing";
import type { ExtractionConfidence, ProductFacts, ValueEvaluation } from "@/types/shopping";

/** Said whenever the verdict is product-relative, i.e. always: the app has no market price data. */
export const VALUE_LIMITATION = "유사 상품의 시장 가격과 원단 등급까지 비교한 평가는 아닙니다.";

export const VALUE_CAVEAT = `${VALUE_LIMITATION} 봉제 품질, 브랜드 프리미엄, 실물 마감은 상품 페이지만으로 확인할 수 없어요.`;

// What a product page cannot show. Listed so a limited verdict names the real gaps instead of "info missing".
const MISSING = ["유사 상품의 시장 가격", "원단 등급", "봉제 품질", "브랜드 프리미엄", "실물 마감"];

function unavailable(
  reason: NonNullable<ValueEvaluation["unavailableReason"]>,
  summary: string,
  product: ProductFacts,
  missing: string[] = MISSING,
): ValueEvaluation {
  return {
    status: "unavailable",
    unavailableReason: reason,
    label: "판단 어려움",
    summary,
    confidence: "low",
    pricing: product.pricing,
    missing,
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

const knownStatement = "현재 판매가와 소재 구성은 확인했지만,";

/**
 * Value judged from the product's own facts: what the buyer pays per piece (a confirmed 1+1 halves it), the
 * fibers, how long it should hold up, and how much care it asks for. It is "product-relative": the app has no
 * market-wide price data, so it never claims "cheaper than similar items" and always says the market and the
 * fabric grade were not compared. Missing price or blend makes it unavailable; a missing market does not.
 * The discount rate is reported but never raises the score, because a list price can be inflated.
 */
export function evaluateValueForMoney(product: ProductFacts, metrics: MaterialMetricMap): ValueEvaluation {
  const pricing = product.pricing;
  const blend = readBlend(product);
  const hasBlend = product.materials.length > 0;

  if (!pricing) {
    return unavailable(
      "no_price",
      hasBlend
        ? "소재 구성은 확인했지만 상품 페이지에서 가격을 읽지 못해 가격 대비 가치를 판단할 수 없어요."
        : "상품 페이지에서 가격과 소재 구성을 모두 읽지 못해 가격 대비 가치를 판단할 수 없어요.",
      product,
      hasBlend ? ["판매가", ...MISSING] : ["판매가", "소재 구성", ...MISSING],
    );
  }

  if (!hasBlend) {
    return unavailable(
      "no_materials",
      "가격은 확인했지만 소재 혼용률을 읽지 못해 가격 대비 가치를 판단할 수 없어요.",
      product,
      ["소재 혼용률", ...MISSING],
    );
  }
  if (blend.knownShare < 0.7) {
    return unavailable(
      "unknown_fibers",
      "가격과 소재 구성은 확인했지만, 소재 대부분의 특성 정보가 없어 가격 대비 가치를 판단하기 어려워요.",
      product,
      ["소재 특성 정보", ...MISSING],
    );
  }

  const baselines = baselinePrice[pricing.currency];
  if (!baselines) {
    return unavailable(
      "unsupported_currency",
      `${knownStatement} ${pricing.currency} 가격은 비교할 기준이 없고, 비슷한 상품의 시장 가격과 원단 등급, 봉제 품질도 알 수 없어 가격 대비 가치를 확정하기 어렵습니다.`,
      product,
    );
  }
  if (product.category === "unknown") {
    return unavailable(
      "unknown_category",
      `${knownStatement} 상품 종류를 알 수 없고, 비슷한 상품의 시장 가격과 원단 등급, 봉제 품질도 알 수 없어 가격 대비 가치를 확정하기 어렵습니다.`,
      product,
    );
  }

  const factor = blend.average((knowledge) => {
    const key = Object.keys(materialKnowledge).find((name) => materialKnowledge[name] === knowledge);
    return (key && fiberCostFactor[key]) || 1;
  });
  if (factor === undefined) {
    return unavailable("unknown_fibers", "가격과 소재 구성은 확인했지만 소재 특성 정보가 없어 가격 대비 가치를 판단하기 어려워요.", product, ["소재 특성 정보", ...MISSING]);
  }

  // A confirmed 1+1 is judged per piece; an unconfirmed "[1+1]" label changes nothing.
  const bundled = pricing.unitPrice !== undefined && pricing.bundleQuantity !== undefined && pricing.bundleQuantity > 1;
  const effectivePrice = bundled ? pricing.unitPrice! : pricing.currentPrice;
  const expectedPrice = baselines[product.category] * factor;
  const ratio = effectivePrice / expectedPrice;

  // Small nudges: how long it should hold up, how much care it asks for, and functional claims the page itself makes.
  const quality = [metrics.durability, metrics.pillingResistance].filter((metric) => metric.available);
  const qualityAverage = quality.length ? quality.reduce((sum, metric) => sum + metric.score, 0) / quality.length : 60;
  const durabilityNudge = Math.max(-5, Math.min(5, Math.round((qualityAverage - 60) / 8)));

  const careMetrics = [metrics.washEase, metrics.dryerSafe].filter((metric) => metric.available);
  const careAverage = careMetrics.length ? careMetrics.reduce((sum, metric) => sum + metric.score, 0) / careMetrics.length : undefined;
  const careNudge = careAverage === undefined ? 0 : careAverage <= 30 ? -3 : careAverage >= 75 ? 2 : 0;

  const claimed = [metrics.moistureWicking, metrics.pillingResistance].filter((metric) => metric.available && metric.source === "product-page").length;
  const functionNudge = Math.min(3, claimed * 2);

  const score = Math.max(0, Math.min(100, Math.round(interpolate(ratio) + durabilityNudge + careNudge + functionNudge)));

  // An estimate against reference points, so never "high"; weak or unconfirmed inputs lower it further.
  const confidence: ExtractionConfidence = pricing.confidence === "low" || blend.knownShare < 0.9 || pricing.bundleUnconfirmed ? "low" : "medium";

  const unitText = bundled ? `1+1 기준 개당 약 ${formatPriceLabel(effectivePrice, pricing.currency)}입니다. ` : "";
  const priceWord = pricing.discountRate !== undefined ? "할인 가격" : "가격";
  const [label, summary] =
    score >= 72
      ? (["가성비 좋음", `${unitText}현재 소재 구성과 ${priceWord}을 고려하면 실용적인 가격대예요.`] as const)
      : score >= 50
        ? (["가성비 보통", `${unitText}가격은 부담이 크지 않지만, 소재 구성이 특별히 프리미엄한 편은 아니에요.`] as const)
        : (["가성비 아쉬움", `${unitText}현재 가격 대비 소재와 기능 구성은 조금 아쉬운 편이에요.`] as const);

  return {
    status: "available",
    scope: "product-relative",
    marketComparison: "unavailable",
    score,
    label,
    summary,
    confidence,
    pricing,
    expectedPrice: Math.round(expectedPrice),
    unitPrice: bundled ? effectivePrice : undefined,
    bundleQuantity: bundled ? pricing.bundleQuantity : undefined,
    missing: MISSING,
    caveat: VALUE_CAVEAT,
  };
}

// Kept for callers that only have the blend name: resolves a fiber name to its knowledge key.
export { normalizeMaterialName };
