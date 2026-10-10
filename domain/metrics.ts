import { fiberClassLabel, materialKnowledge, type FiberClass, type MaterialKnowledge } from "@/data/materials";
import { parseManufacturerCare, readCareSignals, readFeatureClaims, washScore, type CareSignals } from "@/domain/careSignals";
import { tierReason } from "@/domain/metricCopy";
import { normalizeMaterialName } from "@/domain/materialEvaluation";
import { pickBySource } from "@/domain/sourcePriority";
import type { EvidenceSource, ExtractionConfidence, MaterialEvaluation, MetricBasis, MetricKey, MetricResult, ProductFacts } from "@/types/shopping";

export type MaterialMetricKey = Exclude<MetricKey, "valueForMoney">;
export type MaterialMetricMap = Record<MaterialMetricKey, MetricResult>;

const basisOf = (source: EvidenceSource): MetricBasis =>
  source === "material-knowledge" || source === "generic" ? "material_inference" : "product_page";

function metric(key: MetricKey, source: EvidenceSource, fields: Pick<MetricResult, "available" | "score" | "confidence" | "reason"> & { note?: string }): MetricResult {
  return { key, source, basis: basisOf(source), ...fields };
}

const unavailable = (key: MetricKey, reason: string): MetricResult => metric(key, "material-knowledge", { available: false, score: 0, confidence: "low", reason });

type KnownFiber = { name: string; percentage: number; knowledge: MaterialKnowledge };
type Blend = {
  knownShare: number;
  known: KnownFiber[];
  average: (pick: (knowledge: MaterialKnowledge) => number) => number | undefined;
  /** Percent of the known fibers that belong to a class. */
  classShare: (fiberClass: FiberClass) => number | undefined;
};

/** Averages per-fiber properties by blend percentage, over the fibers we actually know about. */
export function readBlend(product: ProductFacts): Blend {
  const listed = product.materials.filter((item) => item.percentage > 0);
  const total = listed.reduce((sum, item) => sum + item.percentage, 0);
  const known = listed.flatMap((item) => {
    const knowledge = materialKnowledge[normalizeMaterialName(item.name)];
    return knowledge ? [{ name: item.name, percentage: item.percentage, knowledge }] : [];
  });
  const knownTotal = known.reduce((sum, item) => sum + item.percentage, 0);

  return {
    knownShare: total > 0 ? knownTotal / total : 0,
    known,
    average: (pick) => (knownTotal > 0 ? known.reduce((sum, item) => sum + pick(item.knowledge) * item.percentage, 0) / knownTotal : undefined),
    classShare: (fiberClass) =>
      knownTotal > 0 ? (known.filter((item) => item.knowledge.fiberClass === fiberClass).reduce((sum, item) => sum + item.percentage, 0) / knownTotal) * 100 : undefined,
  };
}

/** Estimates from fiber properties are never "high": knit density, finish and construction are unknown. */
export function inferenceConfidence(knownShare: number): ExtractionConfidence | undefined {
  if (knownShare >= 0.85) return "medium";
  if (knownShare >= 0.5) return "low";
  return undefined;
}

const NEED_BLEND = "소재 구성을 충분히 확인하지 못했어요.";

type FiberOptions = {
  /** Highest score a blend alone may reach: a property that also depends on construction is never a top mark. */
  cap?: number;
  /** Highest confidence a blend alone may reach. */
  confidenceCap?: ExtractionConfidence;
  /** Replaces the default sentence; receives the uncapped score. */
  reason?: (score: number, capped: boolean) => string;
};

function fromFibers(key: MaterialMetricKey, blend: Blend, pick: (knowledge: MaterialKnowledge) => number, options: FiberOptions = {}): MetricResult {
  const inferred = inferenceConfidence(blend.knownShare);
  const value = blend.average(pick);
  if (!inferred || value === undefined) return unavailable(key, NEED_BLEND);

  const raw = Math.round(Math.max(0, Math.min(5, value)) * 20);
  const score = options.cap !== undefined ? Math.min(raw, options.cap) : raw;
  const confidence = options.confidenceCap === "low" || inferred === "low" ? "low" : inferred;
  const partial = inferred === "low" ? " 일부 소재 정보가 부족해 참고용이에요." : "";
  const reason = (options.reason ? options.reason(raw, score < raw) : tierReason(key, score)) + partial;
  return metric(key, "material-knowledge", { available: true, score, confidence, reason });
}

const joinNames = (items: KnownFiber[]) => items.map((item) => `${item.name} ${item.percentage}%`).join(", ");

function washReason(wash: NonNullable<CareSignals["wash"]>, quote: string) {
  const label = `상품 페이지의 세탁 안내(“${quote}”) 기준이에요.`;
  switch (wash) {
    case "machine":
      return `${label} 세탁기로 관리할 수 있어 편한 편이에요.`;
    case "machine_gentle":
      return `${label} 세탁기를 쓰되 순한 코스가 필요해요.`;
    case "gentle":
      return `${label} 찬물이나 순한 세탁이 필요해요.`;
    case "hand_or_gentle":
      return `${label} 손세탁이나 울코스처럼 조심스러운 세탁이 필요해요.`;
    case "hand":
      return `${label} 손세탁이 필요해 세탁이 편한 편은 아니에요.`;
    default:
      return `${label} 드라이클리닝이 필요해 집에서 관리하기는 번거로워요.`;
  }
}

const firstOfKind = (items: ReturnType<typeof parseManufacturerCare>, kinds: string[]) => items.find((item) => kinds.includes(item.kind))?.text;

/**
 * One independent metric per preference. Washing, drying and wrinkling are read from the manufacturer's
 * instructions first; only when the page is silent are they estimated from the fibers. Every metric carries the
 * source and the reason, and every screen reads this object instead of working the same question out again.
 */
export function evaluateMaterialMetrics(product: ProductFacts): MaterialMetricMap {
  const blend = readBlend(product);
  // Care instructions printed on a detail image and read by a vision model are still the seller's own words, but a model
  // read them, so they count as reference-level (medium), not as a firm label.
  const careFromImage = product.extractionMetadata?.vision?.fields.includes("care") ?? false;
  const careSource: EvidenceSource = careFromImage ? "image-vision" : "manufacturer-care";
  const careConfidence: ExtractionConfidence = careFromImage ? "medium" : "high";
  const imageSuffix = careFromImage ? " 상세 이미지에서 AI가 읽은 안내예요." : "";
  const care = readCareSignals(product.careInstructions);
  const careItems = parseManufacturerCare(product.careInstructions);
  const claims = readFeatureClaims([product.productName, product.description, ...(product.careInstructions ?? [])].join(" "));
  const fromTraits = (key: keyof MaterialEvaluation["traits"], invert = false) => (knowledge: MaterialKnowledge) =>
    invert ? 6 - knowledge.traits[key] : knowledge.traits[key];

  const washText = firstOfKind(careItems, ["washing", "dry_clean"]);
  const washFromPage =
    care.wash !== undefined
      ? metric("washEase", careSource, {
          available: true,
          score: washScore[care.wash],
          confidence: careConfidence,
          reason: washReason(care.wash, washText ?? "세탁 안내") + imageSuffix,
        })
      : undefined;

  const dryText = firstOfKind(careItems, ["drying"]);
  const dryerFromPage =
    care.dryer === "allowed"
      ? metric("dryerSafe", careSource, { available: true, score: 85, confidence: careConfidence, reason: `상품 페이지에서 건조기 사용이 가능하다고 안내해요.${imageSuffix}` })
      : care.dryer === "forbidden"
        ? metric("dryerSafe", careSource, { available: true, score: 8, confidence: careConfidence, reason: `상품 페이지에서 건조기 사용을 금지해요.${imageSuffix}` })
        : care.dryer === "natural_only"
          ? metric("dryerSafe", careSource, {
              available: true,
              score: 12,
              confidence: careConfidence,
              reason: `상품 페이지에서 “${dryText ?? "자연 건조"}” 지침을 확인했어요. 건조기는 권장되지 않아요.${imageSuffix}`,
            })
          : undefined;

  const wrinkleFromPage =
    care.wrinkle === "low_maintenance"
      ? metric("wrinkleResistance", careSource, { available: true, score: 85, confidence: careConfidence, reason: `상품 안내에 구김이 적다는 설명이 있어요.${imageSuffix}` })
      : care.wrinkle === "wrinkles_easily"
        ? metric("wrinkleResistance", careSource, { available: true, score: 25, confidence: careConfidence, reason: `상품 안내에 구김 주의 또는 다림질 설명이 있어요.${imageSuffix}` })
        : undefined;

  const fiberWash = fromFibers("washEase", blend, fromTraits("careEase"));
  const fiberDryer = fromFibers("dryerSafe", blend, (knowledge) => knowledge.extras.dryerSafe);
  const fiberWrinkle = fromFibers("wrinkleResistance", blend, (knowledge) => knowledge.extras.wrinkleResistance);

  const absorbency = blend.average((knowledge) => knowledge.extras.absorbency);
  const quickDry = blend.average((knowledge) => knowledge.extras.quickDry);

  // Absorbing sweat, moving it off the skin and drying fast are three separate properties. A blend can show
  // the first; the other two depend on the yarn, the knit and any functional finish, so without a claim on the
  // page they are only a hint (capped at "보통", low confidence).
  const wickingFromClaim = claims.fastDry
    ? metric("moistureWicking", "product-page", { available: true, score: 80, confidence: "medium", reason: "상품 설명에 속건·땀 배출 기능 문구가 있어요." })
    : undefined;
  const wickingFromFibers = fromFibers("moistureWicking", blend, (knowledge) => (knowledge.extras.moistureWicking + knowledge.extras.quickDry) / 2, {
    cap: 60,
    confidenceCap: "low",
    reason: () =>
      absorbency !== undefined && quickDry !== undefined && absorbency >= 3.5 && quickDry <= 3.5
        ? "땀을 흡수하는 소재가 많지만 땀을 밖으로 내보내거나 빨리 마르는 기능은 혼용률만으로 확인할 수 없어요."
        : "땀 배출과 건조 속도는 혼용률만으로 확정할 수 없어요. 기능성 가공 정보가 필요해요.",
  });

  const pillingFromClaim = claims.antiPilling
    ? metric("pillingResistance", "product-page", { available: true, score: 80, confidence: "medium", reason: "상품 설명에 보풀 방지 문구가 있어요." })
    : undefined;
  // Pilling follows the yarn, the knit and the finish at least as much as the fiber. A blend alone is never a "good".
  const pillingFromFibers = fromFibers("pillingResistance", blend, fromTraits("pillingRisk", true), {
    cap: 64,
    confidenceCap: "low",
    reason: (raw, capped) => {
      const limit = "혼용률만으로는 보풀 저항성을 확정하기 어려워요. 원사, 조직, 가공 정보가 필요해요.";
      return !capped && raw < 48 ? `${tierReason("pillingResistance", raw)} ${limit}` : limit;
    },
  });

  return {
    softness: fromFibers("softness", blend, fromTraits("softness")),
    lightweight: fromFibers("lightweight", blend, fromTraits("weight")),
    warmth: fromFibers("warmth", blend, fromTraits("warmth")),
    breathability: fromFibers("breathability", blend, fromTraits("breathability")),
    moistureWicking: pickBySource([wickingFromClaim, wickingFromFibers]) ?? wickingFromFibers,
    stretch: fromFibers("stretch", blend, fromTraits("stretch")),
    washEase: pickBySource([washFromPage, withNote(fiberWash, "제조사 안내가 없어 소재로 예상했어요.")]) ?? fiberWash,
    dryerSafe:
      pickBySource([dryerFromPage, fiberDryer.available ? { ...fiberDryer, confidence: "low", reason: "제조사 건조기 안내가 없어 소재로 예상했어요.", note: "제조사 건조기 안내가 없어 소재로 예상했어요." } : fiberDryer]) ?? fiberDryer,
    pillingResistance: pickBySource([pillingFromClaim, pillingFromFibers]) ?? pillingFromFibers,
    wrinkleResistance: pickBySource([wrinkleFromPage, fiberWrinkle]) ?? fiberWrinkle,
    durability: fromFibers("durability", blend, fromTraits("durability")),
    naturalFiberRatio: naturalFiberMetric(blend, product.materials.some((item) => item.source === "image-vision")),
  };
}

function withNote(result: MetricResult, note: string): MetricResult {
  return result.available ? { ...result, note, reason: `${result.reason ?? ""} ${note}`.trim() } : result;
}

// Regenerated cellulose comes from plants but is dissolved and re-spun, so it is not scored like cotton or wool.
// It counts for part of a natural fiber: enough to show it is plant based, not enough to equal one.
const CELLULOSIC_WEIGHT = 0.4;

function naturalFiberMetric(blend: Blend, fromImage: boolean): MetricResult {
  const confidence = inferenceConfidence(blend.knownShare);
  const natural = blend.classShare("natural");
  const cellulosic = blend.classShare("regenerated-cellulosic");
  if (!confidence || natural === undefined || cellulosic === undefined) return unavailable("naturalFiberRatio", NEED_BLEND);

  const score = Math.round(natural + cellulosic * CELLULOSIC_WEIGHT);
  const cellulosicNames = blend.known.filter((item) => item.knowledge.fiberClass === "regenerated-cellulosic");
  const naturalNames = blend.known.filter((item) => item.knowledge.fiberClass === "natural");

  const parts = [
    naturalNames.length ? `천연 섬유는 ${joinNames(naturalNames)}예요.` : "천연 섬유는 없어요.",
    cellulosicNames.length
      ? `${joinNames(cellulosicNames)}는 식물 원료지만 가공해 만든 ${fiberClassLabel["regenerated-cellulosic"]}라 천연 섬유로 세지 않고 일부만 반영했어요.`
      : "",
  ].filter(Boolean);

  // The share is read straight off the page's blend, so it is as reliable as the blend itself.
  // A blend read from an image by a model is a reference value, never a firm one.
  return metric("naturalFiberRatio", fromImage ? "image-vision" : "product-page", {
    available: true,
    score,
    confidence: fromImage ? (confidence === "medium" ? "medium" : "low") : confidence === "medium" ? "high" : "low",
    reason: `${parts.join(" ")}${fromImage ? " 상세 이미지에서 AI가 읽은 혼용률이에요." : ""}${confidence === "low" ? " 일부 소재 정보가 부족해 참고용이에요." : ""}`,
  });
}
