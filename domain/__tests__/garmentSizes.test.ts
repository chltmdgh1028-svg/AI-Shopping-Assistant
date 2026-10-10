import { describe, expect, it } from "vitest";
import { demoProduct } from "@/data/demoProduct";
import { categorizeProduct, garmentMeasures, garmentTypeOf } from "@/domain/garment";
import { recommendSize } from "@/domain/sizeRecommendation";
import { interpretWidth } from "@/domain/sizeMeasurements";
import { evaluateProduct } from "@/domain/evaluation";
import { buildPricing } from "@/domain/pricing";
import { parseSizeTable } from "@/services/extraction/adapters/zigzagDetailApi";
import type { ProductFacts, UserProfile } from "@/types/shopping";

describe("category detection", () => {
  it.each([
    ["남자 베이직 댄디 스판 와이드 슬랙스 팬츠", "pants"],
    ["남자 데일리 일자 캐주얼 와이드 데님 청바지", "pants"],
    ["스웨트 코튼 라인 팬츠 스트링 조거", "pants"],
    ["베니즈 브이넥 베이직 긴팔 니트 가디건", "knitwear"],
    ["남자 베이직 코튼 심플 카라 폴로 티셔츠", "top"],
    ["V넥 라벨 패치 맨투맨 티셔츠", "top"],
    ["기모 후드 티", "top"],
    ["피타 셔링 스카프 블라우스", "shirt"],
    ["레이스 랩 골지 나시", "top"],
    ["플라워 롱 원피스", "dress"],
    ["니트 원피스", "dress"],
    ["A라인 미디 스커트", "skirt"],
    ["데님 스커트", "skirt"],
    ["하이넥 숏 트렌치 코트 자켓", "outerwear"],
    ["후드 집업 점퍼", "outerwear"],
    ["귀여운 키링", "unknown"],
  ] as const)("%s → %s", (name, expected) => {
    expect(categorizeProduct(name)).toBe(expected);
  });

  it("maps a category to the kind of size table it has", () => {
    expect(garmentTypeOf("knitwear")).toBe("top");
    expect(garmentTypeOf("top")).toBe("top");
    expect(garmentTypeOf("shirt")).toBe("top");
    expect(garmentTypeOf("pants")).toBe("bottom");
    expect(garmentTypeOf("skirt")).toBe("skirt");
    expect(garmentTypeOf("dress")).toBe("onepiece");
    expect(garmentTypeOf("outerwear")).toBe("outer");
  });

  it("lets the table decide when the category is unknown", () => {
    expect(garmentTypeOf("unknown", [{ name: "M", rise: 28 }])).toBe("bottom");
    expect(garmentTypeOf("unknown", [{ name: "M", thigh: 30 }])).toBe("bottom");
    expect(garmentTypeOf("unknown", [{ name: "M", chest: 100 }])).toBe("top");
    expect(garmentTypeOf("unknown", [{ name: "M", waist: 70 }])).toBe("bottom");
    expect(garmentTypeOf("unknown", [{ name: "M" }])).toBeUndefined();
  });

  it("names the measurements that matter for each kind", () => {
    expect(garmentMeasures.top).toEqual(["shoulder", "chest", "sleeve", "length"]);
    expect(garmentMeasures.bottom).toEqual(["waist", "hip", "thigh", "rise", "hem", "length"]);
    expect(garmentMeasures.onepiece).toEqual(["shoulder", "chest", "waist", "hip", "sleeve", "length"]);
    expect(garmentMeasures.skirt).toEqual(["waist", "hip", "length", "hem"]);
    expect(garmentMeasures.outer).toEqual(["shoulder", "chest", "sleeve", "length"]);
  });
});

describe("laid-flat widths (단면) are doubled only when the evidence supports it", () => {
  it.each([
    ["chest", 52, 104],
    ["waist", 36, 72],
    ["hip", 48, 96],
    ["thigh", 30, 60],
    ["hem", 20, 40],
  ] as const)("labelled flat, small enough to be a flat %s: doubled", (measure, printed, expected) => {
    expect(interpretWidth(measure, printed, "flat")).toMatchObject({ value: expected, converted: true, confidence: "high" });
  });

  it.each([
    ["chest", 126],
    ["waist", 76],
    ["hip", 100],
    ["thigh", 56],
    ["hem", 46],
  ] as const)("labelled flat but too large to be a flat %s: used as written, with low confidence", (measure, printed) => {
    expect(interpretWidth(measure, printed, "flat")).toMatchObject({ value: printed, converted: false, confidence: "low" });
  });

  it("never touches a width the page calls a circumference", () => {
    expect(interpretWidth("waist", 36, "circumference")).toMatchObject({ value: 36, converted: false, confidence: "high" });
  });

  it("without a label: doubles what cannot be a circumference, keeps what cannot be flat, and leaves the overlap alone", () => {
    expect(interpretWidth("chest", 52, "unknown")).toMatchObject({ value: 104, converted: true, confidence: "medium" });
    expect(interpretWidth("chest", 100, "unknown")).toMatchObject({ value: 100, converted: false, confidence: "medium" });
    expect(interpretWidth("chest", 78, "unknown")).toMatchObject({ value: 78, converted: false, confidence: "low" });
    expect(interpretWidth("waist", 60, "unknown")).toMatchObject({ value: 60, converted: false, confidence: "low" });
  });
});

describe("size tables by garment", () => {
  it("TOP", () => {
    const { sizes } = parseSizeTable([["사이즈", "총기장", "어깨단면", "가슴단면", "소매길이"], ["M", "66", "45", "52", "60"]]);
    expect(sizes[0]).toMatchObject({ name: "M", length: 66, shoulder: 45, chest: 104, sleeve: 60 });
  });

  it("BOTTOM: waist, hip, thigh, rise, hem and length, laid-flat widths doubled", () => {
    const { sizes } = parseSizeTable([
      ["사이즈", "총기장", "허리단면", "엉덩이단면", "허벅지단면", "밑위", "밑단단면"],
      ["28", "100", "36", "48", "30", "29", "20"],
    ]);
    expect(sizes[0]).toMatchObject({ name: "28", length: 100, waist: 72, hip: 96, thigh: 60, rise: 29, hem: 40 });
    // The rise is a length: it is not doubled.
    expect(sizes[0].rise).toBe(29);
  });

  it("SKIRT", () => {
    const { sizes } = parseSizeTable([["사이즈", "총기장", "허리단면", "엉덩이단면", "밑단단면"], ["S", "60", "32", "44", "40"]]);
    expect(sizes[0]).toMatchObject({ name: "S", length: 60, waist: 64, hip: 88, hem: 80 });
  });

  it("ONE-PIECE", () => {
    const { sizes } = parseSizeTable([["사이즈", "총기장", "어깨단면", "가슴단면", "허리단면", "엉덩이단면", "소매길이"], ["FREE", "110", "38", "46", "38", "52", "56"]]);
    expect(sizes[0]).toMatchObject({ name: "FREE", length: 110, shoulder: 38, chest: 92, waist: 76, hip: 104, sleeve: 56 });
  });

  it("reads the hem of a top as body-wide, and the hem of trousers as a leg opening", () => {
    const top = parseSizeTable([["사이즈", "가슴단면", "밑단단면"], ["XL", "53", "53.5"]]);
    expect(top.sizes[0]).toMatchObject({ chest: 106, hem: 107, confidence: "high" });
    const trousers = parseSizeTable([["사이즈", "허리단면", "밑단단면"], ["M", "36", "20"]]);
    expect(trousers.sizes[0]).toMatchObject({ waist: 72, hem: 40, confidence: "high" });
  });

  it("reads a circumference column as it is", () => {
    const { sizes } = parseSizeTable([["사이즈", "허리둘레", "엉덩이둘레"], ["M", "76", "98"]]);
    expect(sizes[0]).toMatchObject({ waist: 76, hip: 98 });
  });

  it("does not take a sleeve width for the sleeve length", () => {
    const { sizes } = parseSizeTable([["사이즈", "가슴단면", "소매단면", "소매길이"], ["M", "50", "12", "60"]]);
    expect(sizes[0].sleeve).toBe(60);
  });

  it("does not turn a seller's circumference-in-a-flat-column into an impossible chest, and says so", () => {
    const { sizes, warnings } = parseSizeTable([["사이즈", "가슴단면"], ["F", "126"]]);
    expect(sizes[0].chest).toBe(126);
    expect(sizes[0].confidence).toBe("low");
    expect(warnings.join(" ")).toContain("그대로");
  });
});

describe("fitting trousers and skirts at the waist", () => {
  const profile: UserProfile = { gender: "female", heightCm: 165, weightKg: 55, preferredFit: "regular" };
  const trousers = (sizes: ProductFacts["sizes"]): ProductFacts => ({ ...demoProduct, category: "pants", sizes });
  const sizes = [
    { name: "S", waist: 66, hip: 92 },
    { name: "M", waist: 70, hip: 96 },
    { name: "L", waist: 74, hip: 100 },
  ];

  it("compares the waist, not the chest", () => {
    const result = recommendSize({ ...profile, waistCm: 68 }, trousers(sizes));
    // 68cm waist plus 2cm of ease is 70: size M.
    expect(result).toMatchObject({ recommendedSize: "M", confidence: "medium", basis: "measured" });
    expect(result.alternatives).toEqual(["S", "L"]);
  });

  it("does not guess a waist from height and weight", () => {
    const result = recommendSize(profile, trousers(sizes));
    expect(result.recommendedSize).toBeUndefined();
    expect(result.confidence).toBe("low");
    expect(result.reason).toContain("허리둘레");
    expect(result.alternatives).toEqual(["S", "M", "L"]);
  });

  it("asks to check the page when the table has no waist at all", () => {
    const result = recommendSize({ ...profile, waistCm: 68 }, trousers([{ name: "M", length: 45 }]));
    expect(result.recommendedSize).toBeUndefined();
    expect(result.reason).toContain("허리 치수가 없어");
  });

  it("treats a skirt the same way, and an unknown category with a waist table as trousers", () => {
    expect(recommendSize({ ...profile, waistCm: 72 }, { ...trousers(sizes), category: "skirt" }).recommendedSize).toBe("L");
    expect(recommendSize({ ...profile, waistCm: 68 }, { ...trousers(sizes), category: "unknown" }).recommendedSize).toBe("M");
  });

  it("leaves tops on the chest", () => {
    const top = recommendSize({ ...profile, chestCm: 90 }, { ...demoProduct, category: "knitwear", sizes: [{ name: "M", chest: 100 }, { name: "L", chest: 106 }] });
    expect(top.recommendedSize).toBeDefined();
    expect(top.basis).toBe("measured");
  });
});

describe("categories that did not exist before still get a value judgement", () => {
  it("prices a T-shirt and a skirt against their own reference", () => {
    const priced = (category: ProductFacts["category"]): ProductFacts => ({
      ...demoProduct,
      category,
      pricing: buildPricing({ currentPrice: 29000, currency: "KRW", source: "structured-data", confidence: "high" }),
    });
    expect(evaluateProduct(priced("top")).value.status).toBe("available");
    expect(evaluateProduct(priced("skirt")).value.status).toBe("available");
  });
});
