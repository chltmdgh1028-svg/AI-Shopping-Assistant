import { materialKnowledge, type MaterialKnowledge } from "@/data/materials";
import { readCareSignals, washScore } from "@/domain/careSignals";
import { normalizeMaterialName } from "@/domain/materialEvaluation";
import type { ExtractionConfidence, MaterialEvaluation, MetricKey, MetricResult, ProductFacts } from "@/types/shopping";

export type MaterialMetricKey = Exclude<MetricKey, "valueForMoney">;
export type MaterialMetricMap = Record<MaterialMetricKey, MetricResult>;

const unavailable = (note: string): MetricResult => ({ available: false, score: 0, confidence: "low", basis: "material_inference", note });

type Blend = { knownShare: number; average: (pick: (knowledge: MaterialKnowledge) => number) => number | undefined; naturalShare: number | undefined };

/** Averages per-fiber properties by blend percentage, over the fibers we actually know about. */
export function readBlend(product: ProductFacts): Blend {
  const listed = product.materials.filter((item) => item.percentage > 0);
  const total = listed.reduce((sum, item) => sum + item.percentage, 0);
  const known = listed.flatMap((item) => {
    const knowledge = materialKnowledge[normalizeMaterialName(item.name)];
    return knowledge ? [{ knowledge, percentage: item.percentage }] : [];
  });
  const knownTotal = known.reduce((sum, item) => sum + item.percentage, 0);

  return {
    knownShare: total > 0 ? knownTotal / total : 0,
    average: (pick) => (knownTotal > 0 ? known.reduce((sum, item) => sum + pick(item.knowledge) * item.percentage, 0) / knownTotal : undefined),
    naturalShare:
      knownTotal > 0 ? (known.filter((item) => item.knowledge.natural).reduce((sum, item) => sum + item.percentage, 0) / knownTotal) * 100 : undefined,
  };
}

/** Estimates from fiber properties are never "high": knit density, finish and construction are unknown. */
export function inferenceConfidence(knownShare: number): ExtractionConfidence | undefined {
  if (knownShare >= 0.85) return "medium";
  if (knownShare >= 0.5) return "low";
  return undefined;
}

function fromFibers(blend: Blend, pick: (knowledge: MaterialKnowledge) => number, note?: string): MetricResult {
  const confidence = inferenceConfidence(blend.knownShare);
  const value = blend.average(pick);
  if (!confidence || value === undefined) return unavailable("소재 구성을 충분히 확인하지 못했어요.");
  return {
    available: true,
    score: Math.round(Math.max(0, Math.min(5, value)) * 20),
    confidence,
    basis: "material_inference",
    note: confidence === "low" ? "일부 소재 정보가 부족해 참고용이에요." : note,
  };
}

/**
 * One independent metric per preference. Washing, drying and wrinkling are read from the manufacturer's
 * instructions first; only when the page is silent are they estimated from the fibers.
 */
export function evaluateMaterialMetrics(product: ProductFacts): MaterialMetricMap {
  const blend = readBlend(product);
  const care = readCareSignals(product.careInstructions);
  const fromTraits = (key: keyof MaterialEvaluation["traits"], invert = false) => (knowledge: MaterialKnowledge) =>
    invert ? 6 - knowledge.traits[key] : knowledge.traits[key];

  const washFromPage = care.wash ? washScore[care.wash] : undefined;
  const dryerFromPage = care.dryer === "allowed" ? 85 : care.dryer === "forbidden" ? 8 : undefined;
  const wrinkleFromPage = care.wrinkle === "low_maintenance" ? 85 : care.wrinkle === "wrinkles_easily" ? 25 : undefined;

  const fiberDryer = fromFibers(blend, (knowledge) => knowledge.extras.dryerSafe);
  const fiberWrinkle = fromFibers(blend, (knowledge) => knowledge.extras.wrinkleResistance);

  return {
    softness: fromFibers(blend, fromTraits("softness")),
    lightweight: fromFibers(blend, fromTraits("weight")),
    warmth: fromFibers(blend, fromTraits("warmth")),
    breathability: fromFibers(blend, fromTraits("breathability")),
    moistureWicking: fromFibers(blend, (knowledge) => knowledge.extras.moistureWicking),
    stretch: fromFibers(blend, fromTraits("stretch")),
    washEase:
      washFromPage !== undefined
        ? { available: true, score: washFromPage, confidence: "high", basis: "product_page", note: "제조사 세탁 안내 기준이에요." }
        : fromFibers(blend, fromTraits("careEase"), "제조사 안내가 없어 소재로 예상했어요."),
    dryerSafe:
      dryerFromPage !== undefined
        ? { available: true, score: dryerFromPage, confidence: "high", basis: "product_page", note: "제조사 건조 안내 기준이에요." }
        : fiberDryer.available
          ? { ...fiberDryer, confidence: "low", note: "제조사 건조기 안내가 없어 소재로 예상했어요." }
          : fiberDryer,
    pillingResistance: fromFibers(blend, fromTraits("pillingRisk", true)),
    wrinkleResistance:
      wrinkleFromPage !== undefined
        ? { available: true, score: wrinkleFromPage, confidence: "high", basis: "product_page", note: "상품 안내 기준이에요." }
        : fiberWrinkle,
    durability: fromFibers(blend, fromTraits("durability")),
    naturalFiberRatio: (() => {
      const confidence = inferenceConfidence(blend.knownShare);
      if (!confidence || blend.naturalShare === undefined) return unavailable("소재 구성을 충분히 확인하지 못했어요.");
      // The share is read straight off the page's blend, so it is as reliable as the blend itself.
      return {
        available: true,
        score: Math.round(blend.naturalShare),
        confidence: confidence === "medium" ? "high" : "low",
        basis: "product_page",
        note: confidence === "low" ? "일부 소재 정보가 부족해 참고용이에요." : undefined,
      };
    })(),
  };
}
