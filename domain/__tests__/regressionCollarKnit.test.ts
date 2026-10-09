import { describe, expect, it } from "vitest";
import { buildCareGuide } from "@/domain/careGuide";
import { parseManufacturerCare, readCareSignals } from "@/domain/careSignals";
import { evaluateProduct } from "@/domain/evaluation";
import { evaluateMaterials, normalizeMaterialName } from "@/domain/materialEvaluation";
import { calculatePreferenceScore, matchPreferences } from "@/domain/preferenceMatching";
import { calculateCompatibilityScore } from "@/domain/scoring";
import { recommendSize } from "@/domain/sizeRecommendation";
import { pickBySource } from "@/domain/sourcePriority";
import { sizeKicker, sizeTitle, careVerdict } from "@/components/ResultParts";
import type { MetricResult, PreferenceId, UserPreference } from "@/types/shopping";
import { allPreferences, collarKnit, collarKnitConfirmedBundle, collarKnitNameOnlyBundle, heightWeightProfile } from "./fixtures/collarKnit";

const prefs = (...ids: PreferenceId[]): UserPreference[] => ids.map((id) => ({ id, weight: 2 as const }));

function analyze(product = collarKnit, preferences = allPreferences) {
  const material = evaluateMaterials(product.materials);
  const evaluation = evaluateProduct(product);
  const matches = matchPreferences(preferences, material, product, evaluation);
  const size = recommendSize(heightWeightProfile, product);
  const care = buildCareGuide(product, material, evaluation);
  const score = calculateCompatibilityScore({ preferences, preferenceMatches: matches, material, product, size, evaluation });
  return { material, evaluation, matches, size, care, score };
}

const matchFor = (matches: ReturnType<typeof analyze>["matches"], id: PreferenceId) => matches.find((match) => match.preferenceId === id)!;

describe("collar knit: Viscose is known material", () => {
  it("is not an unknown material", () => {
    expect(normalizeMaterialName("Viscose")).toBe("viscose");
    expect(normalizeMaterialName("비스코스")).toBe("viscose");
    const { material } = analyze();
    const note = material.materialNotes.find((item) => item.name === "Viscose")!;
    expect(note.cons.join(" ")).not.toContain("확인되지 않아");
    expect(note.pros.join(" ")).not.toContain("더 있으면");
    expect(material.assumptions).toEqual([]);
  });

  it("keeps viscose, rayon, modal and lyocell as separate fibers", () => {
    const keys = ["viscose", "rayon", "modal", "lyocell", "tencel"].map(normalizeMaterialName);
    expect(keys).toEqual(["viscose", "rayon", "modal", "lyocell", "lyocell"]);
    expect(normalizeMaterialName("Viscose Rayon")).toBe("viscose");
  });

  it("does not turn 폴리우레탄 into polyester (longest alias wins)", () => {
    expect(normalizeMaterialName("폴리우레탄")).toBe("spandex");
    expect(normalizeMaterialName("폴리에스터")).toBe("polyester");
  });
});

describe("collar knit: one care conclusion everywhere", () => {
  it("reads 'dry in shade' as a dryer-unfriendly label, whatever polyester would allow", () => {
    expect(readCareSignals(collarKnit.careInstructions).dryer).toBe("natural_only");
    const { evaluation } = analyze();
    expect(evaluation.metrics.dryerSafe.score).toBeLessThan(20);
    expect(evaluation.metrics.dryerSafe.source).toBe("manufacturer-care");
    expect(evaluation.metrics.dryerSafe.confidence).toBe("high");
  });

  it("rates 건조기 사용 가능 as poor, and says why", () => {
    const { matches } = analyze();
    const dryer = matchFor(matches, "dryer_friendly");
    expect(dryer.rating).toBe("poor");
    expect(dryer.reason).toContain("그늘에 건조");
  });

  it("shows the same dryer verdict in the care section and the summary", () => {
    const { care, score } = analyze();
    expect(care.dryer).toBe("not_recommended");
    expect(careVerdict(care).join(" ")).toContain("건조기 사용은 비추천");
    expect(score.components.careCompatibility).not.toBeNull();
    expect(score.components.careCompatibility!).toBeLessThan(40);
  });

  it("rates 세탁이 편함 as poor for a hand-wash-only garment", () => {
    const { matches, evaluation, care } = analyze();
    const wash = matchFor(matches, "easy_wash");
    expect(readCareSignals(collarKnit.careInstructions).wash).toBe("hand");
    expect(evaluation.metrics.washEase.score).toBeLessThan(48);
    expect(wash.rating).toBe("poor");
    expect(care.washing_effort).toBe("demanding");
  });

  it("scores washing by what the label asks for: machine > wool course > hand > dry-clean", () => {
    const scoreOf = (lines: string[]) => evaluateProduct({ ...collarKnit, careInstructions: lines }).metrics.washEase.score;
    const machine = scoreOf(["세탁기 가능"]);
    const woolCycle = scoreOf(["세탁기 가능, 울코스"]);
    const hand = scoreOf(["단독 손세탁"]);
    const dryClean = scoreOf(["드라이클리닝"]);
    expect(machine).toBeGreaterThan(woolCycle);
    expect(woolCycle).toBeGreaterThan(hand);
    expect(hand).toBeGreaterThan(dryClean);
  });
});

describe("collar knit: manufacturer care and inferred care never mix", () => {
  it("lists the page's own instructions verbatim under manufacturer", () => {
    const { care } = analyze();
    expect(care.manufacturer?.map((item) => item.text)).toEqual(["단독 손세탁", "그늘에 건조", "비틀기 금지", "표백 금지"]);
    expect(care.manufacturer?.map((item) => item.kind)).toEqual(["washing", "drying", "wring", "bleach"]);
  });

  it("keeps storage and shape advice in inferred, and does not repeat or contradict the label", () => {
    const { care } = analyze();
    const inferred = care.inferred ?? [];
    expect(inferred.some((tip) => tip.kind === "storage")).toBe(true);
    const manufacturerTexts = new Set(care.manufacturer?.map((item) => item.text));
    expect(inferred.every((tip) => !manufacturerTexts.has(tip.text))).toBe(true);
    // The page already prescribes washing and drying, so the app adds nothing there.
    expect(inferred.some((tip) => tip.kind === "washing" || tip.kind === "drying")).toBe(false);
    // The page already says not to wring, so no wring advice is generated.
    expect(inferred.map((tip) => tip.text).join(" ")).not.toContain("비틀거나");
  });

  it("falls back to inferred advice, labelled as such, when the page gives no care text", () => {
    const { care } = analyze({ ...collarKnit, careInstructions: undefined });
    expect(care.source).toBe("material_inference");
    expect(care.manufacturer).toEqual([]);
    expect((care.inferred ?? []).some((tip) => tip.kind === "washing")).toBe(true);
    expect(care.dryer).toBe("unknown");
  });

  it("splits a combined line into separate instructions", () => {
    expect(parseManufacturerCare(["찬물 손세탁, 그늘 건조"]).map((item) => item.kind)).toEqual(["washing", "drying"]);
    expect(parseManufacturerCare(["30도 이하, 단독 손세탁"])).toHaveLength(1);
  });
});

describe("collar knit: fiber taxonomy", () => {
  it("does not score viscose like cotton or wool", () => {
    const natural = (name: string) =>
      evaluateProduct({ ...collarKnit, materials: [{ name, percentage: 50 }, { name: "Polyester", percentage: 50 }] }).metrics.naturalFiberRatio;
    expect(natural("Cotton").score).toBe(50);
    expect(natural("Wool").score).toBe(50);
    expect(natural("Viscose").score).toBeLessThan(natural("Cotton").score);
    expect(natural("Viscose").score).toBeGreaterThan(0);
  });

  it("rates this blend's 천연 소재 as poor and explains why viscose does not count in full", () => {
    const { matches, evaluation } = analyze();
    expect(evaluation.metrics.naturalFiberRatio.score).toBe(20);
    const natural = matchFor(matches, "natural_materials");
    expect(natural.rating).toBe("poor");
    expect(natural.reason).toContain("재생 셀룰로오스");
  });
});

describe("collar knit: blends do not prove performance", () => {
  it("never calls pilling resistance a high-confidence good from the blend alone", () => {
    const { evaluation, matches } = analyze();
    const pilling = evaluation.metrics.pillingResistance;
    expect(pilling.confidence).toBe("low");
    expect(pilling.score).toBeLessThanOrEqual(64);
    expect(pilling.reason).toContain("혼용률만으로");
    expect(matchFor(matches, "low_pilling").rating).not.toMatch(/good|excellent/);
  });

  it("does cap even a pill-resistant fiber at a reference-level result without a finish claim", () => {
    const linen = evaluateProduct({ ...collarKnit, materials: [{ name: "Linen", percentage: 100 }] }).metrics.pillingResistance;
    expect(linen.score).toBeLessThanOrEqual(64);
    expect(linen.confidence).toBe("low");
  });

  it("accepts an explicit anti-pilling claim from the page as a firmer source", () => {
    const claimed = evaluateProduct({ ...collarKnit, description: "보풀 방지 가공 니트" }).metrics.pillingResistance;
    expect(claimed.source).toBe("product-page");
    expect(claimed.score).toBeGreaterThan(64);
  });

  it("never calls moisture wicking / quick dry high-confidence good from the blend alone", () => {
    const { evaluation, matches } = analyze();
    const wicking = evaluation.metrics.moistureWicking;
    expect(wicking.confidence).toBe("low");
    expect(wicking.score).toBeLessThanOrEqual(60);
    expect(wicking.source).toBe("material-knowledge");
    expect(wicking.reason).toContain("혼용률만으로");
    expect(matchFor(matches, "moisture_wicking").rating).not.toMatch(/good|excellent/);
  });

  it("separates absorbing sweat from drying fast for a viscose-led blend", () => {
    const viscose = evaluateProduct({ ...collarKnit, materials: [{ name: "Viscose", percentage: 100 }] }).metrics.moistureWicking;
    expect(viscose.reason).toContain("땀을 흡수하는 소재");
  });

  it("trusts a quick-dry claim that the page itself makes", () => {
    const claimed = evaluateProduct({ ...collarKnit, description: "흡한속건 기능성 원단" }).metrics.moistureWicking;
    expect(claimed.source).toBe("product-page");
    expect(claimed.score).toBeGreaterThan(60);
  });
});

describe("collar knit: value for money", () => {
  it("is evaluated from the price and blend it already has, never 'price or material info missing'", () => {
    const { evaluation } = analyze();
    expect(evaluation.value.status).toBe("available");
    expect(evaluation.value.scope).toBe("product-relative");
    expect(evaluation.value.summary).not.toContain("정보가 부족");
    expect(evaluation.value.caveat).toContain("유사 상품의 시장 가격과 원단 등급까지 비교한 평가는 아닙니다");
    expect(evaluation.value.marketComparison).toBe("unavailable");
    expect(evaluation.value.missing).toContain("원단 등급");
  });

  it("does not claim to beat the market", () => {
    const { evaluation } = analyze(collarKnitConfirmedBundle);
    expect(evaluation.value.summary).not.toMatch(/확실히 저렴|같은 상품군|시장.*저렴/);
  });

  it("judges per piece only when the page confirms the 1+1 contents", () => {
    expect(collarKnitConfirmedBundle.pricing).toMatchObject({ bundleQuantity: 2, unitPrice: 29950, promotionType: "bundle" });
    const confirmed = analyze(collarKnitConfirmedBundle).evaluation.value;
    expect(confirmed.unitPrice).toBe(29950);
    expect(confirmed.summary).toContain("1+1 기준 개당 약");
    expect(confirmed.summary).toContain("29,950원");
    expect(confirmed.label).toBe("가성비 좋음");

    const nameOnly = analyze(collarKnitNameOnlyBundle).evaluation.value;
    expect(collarKnitNameOnlyBundle.pricing?.bundleQuantity).toBeUndefined();
    expect(collarKnitNameOnlyBundle.pricing?.bundleUnconfirmed).toBe(true);
    expect(nameOnly.unitPrice).toBeUndefined();
    expect(nameOnly.confidence).toBe("low");
  });

  it("names the real gaps when it genuinely cannot judge, not a missing price or blend", () => {
    const unknown = analyze({ ...collarKnit, category: "unknown" }).evaluation.value;
    expect(unknown.status).toBe("unavailable");
    expect(unknown.summary).toContain("현재 판매가와 소재 구성은 확인했지만");
    expect(unknown.summary).toContain("시장 가격");
    expect(unknown.summary).not.toContain("가격이나 소재 정보가 부족");
  });
});

describe("collar knit: size wording at low confidence", () => {
  it("is an estimate with fit candidates, not a confident pick", () => {
    const { size } = analyze();
    expect(size.confidence).toBe("low");
    expect(size.basis).toBe("estimated");
    expect(size.fitCandidates).toBeDefined();
    expect(size.reason).toContain("확정하기 어려워요");
    expect(size.reason).toContain("가슴둘레");
    expect(sizeKicker(size)).toBe("예상 사이즈 (추정)");
    expect(sizeTitle(size)).toContain("가능성이 높아요");
    expect(sizeTitle(size)).not.toBe(size.recommendedSize);
  });

  it("keeps a plain recommendation when a chest measurement exists", () => {
    const size = recommendSize({ ...heightWeightProfile, chestCm: 98, shoulderCm: 46 }, collarKnit);
    expect(size.confidence).toBe("high");
    expect(size.fitCandidates).toBeUndefined();
    expect(sizeTitle(size)).toBe(size.recommendedSize);
  });
});

describe("collar knit: unavailable metrics stay out of the denominator", () => {
  it("is the same as never having chosen them", () => {
    const stripped = { ...collarKnit, pricing: undefined, materials: [], careInstructions: undefined };
    const all = analyze(stripped, allPreferences);
    expect(all.matches.every((match) => match.available === false)).toBe(true);
    expect(calculatePreferenceScore(all.matches, allPreferences)).toBeNull();

    const withBlend = { ...collarKnit, pricing: undefined };
    const chosen = analyze(withBlend, prefs("warmth", "soft_touch", "value"));
    const without = analyze(withBlend, prefs("warmth", "soft_touch"));
    expect(matchFor(chosen.matches, "value").available).toBe(false);
    expect(chosen.score.total).toBe(without.score.total);
  });

  it("lets a missing blend drop material fit instead of scoring a guess", () => {
    const { score } = analyze({ ...collarKnit, materials: [] });
    expect(score.components.materialMatch).toBeNull();
  });
});

describe("source priority", () => {
  const make = (source: MetricResult["source"], score: number): MetricResult => ({ available: true, score, confidence: "high", basis: "product_page", source });

  it("prefers the manufacturer over the fiber estimate however they are ordered", () => {
    expect(pickBySource([make("material-knowledge", 100), make("manufacturer-care", 10)])?.score).toBe(10);
    expect(pickBySource([make("manufacturer-care", 10), make("material-knowledge", 100)])?.score).toBe(10);
  });

  it("orders page, structured data, AI extraction, knowledge, generic", () => {
    const sources = ["generic", "material-knowledge", "ai-extraction", "structured-data", "product-page"] as const;
    const winner = pickBySource(sources.map((source, index) => make(source, index)));
    expect(winner?.source).toBe("product-page");
  });

  it("skips unavailable candidates", () => {
    const missing: MetricResult = { available: false, score: 0, confidence: "low", basis: "product_page", source: "manufacturer-care" };
    expect(pickBySource([missing, make("material-knowledge", 70)])?.score).toBe(70);
    expect(pickBySource([missing])).toBeUndefined();
  });
});
