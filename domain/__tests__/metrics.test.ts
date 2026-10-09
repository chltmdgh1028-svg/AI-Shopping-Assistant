import { describe, expect, it } from "vitest";
import { demoProduct } from "@/data/demoProduct";
import { preferenceDefinitions } from "@/data/preferences";
import { readCareSignals } from "@/domain/careSignals";
import { evaluateProduct } from "@/domain/evaluation";
import { evaluateMaterialMetrics } from "@/domain/metrics";
import type { MaterialBlend, ProductFacts } from "@/types/shopping";

const product = (materials: MaterialBlend[], overrides: Partial<ProductFacts> = {}): ProductFacts => ({
  ...demoProduct,
  materials,
  careInstructions: undefined,
  pricing: undefined,
  ...overrides,
});

describe("one metric per preference", () => {
  it("never lets two preferences share a metric", () => {
    const metrics = preferenceDefinitions.map((definition) => definition.metric);
    expect(new Set(metrics).size).toBe(metrics.length);
    expect(metrics).toHaveLength(13);
  });

  it("covers every metric exactly once", () => {
    expect(new Set(preferenceDefinitions.map((definition) => definition.metric))).toEqual(
      new Set([
        "softness",
        "lightweight",
        "warmth",
        "breathability",
        "moistureWicking",
        "stretch",
        "washEase",
        "dryerSafe",
        "pillingResistance",
        "wrinkleResistance",
        "durability",
        "naturalFiberRatio",
        "valueForMoney",
      ]),
    );
  });

  it("has retired the duplicate and the unmeasurable choices", () => {
    const ids = preferenceDefinitions.map((definition) => definition.id) as string[];
    expect(ids).not.toContain("avoid_itchy");
    expect(ids).not.toContain("quality_first");
  });
});

describe("breathability and moisture wicking are separate", () => {
  it("scores them differently for the same fabric", () => {
    const polyester = evaluateMaterialMetrics(product([{ name: "Polyester", percentage: 100 }]));
    // Polyester suggests quick drying but does not let air through. Without a page claim the wicking estimate is
    // capped at "보통", so the gap is smaller than the raw fiber property, yet still points the right way.
    expect(polyester.moistureWicking.score).toBeGreaterThan(polyester.breathability.score);
    expect(polyester.moistureWicking.score).toBeLessThanOrEqual(60);

    const cotton = evaluateMaterialMetrics(product([{ name: "Cotton", percentage: 100 }]));
    // Cotton is the opposite: airy, slow to dry.
    expect(cotton.breathability.score).toBeGreaterThan(cotton.moistureWicking.score + 30);
  });

  it("does not move one when the other's fiber property would", () => {
    const wool = evaluateMaterialMetrics(product([{ name: "Wool", percentage: 100 }]));
    const linen = evaluateMaterialMetrics(product([{ name: "Linen", percentage: 100 }]));
    expect(wool.breathability.score).not.toBe(wool.moistureWicking.score);
    expect(linen.breathability.score).toBe(100);
    expect(linen.moistureWicking.score).toBe(60); // capped: a blend alone cannot confirm wicking
  });
});

describe("washing, drying and wrinkling are separate", () => {
  it("represents easy to wash with no dryer", () => {
    const metrics = evaluateMaterialMetrics(
      product([{ name: "Polyester", percentage: 100 }], { careInstructions: ["세탁: 세탁기 가능", "건조: 건조기 사용 금지, 그늘에서 건조"] }),
    );
    expect(metrics.washEase.score).toBeGreaterThanOrEqual(80);
    expect(metrics.dryerSafe.score).toBeLessThan(20);
    expect(metrics.washEase.basis).toBe("product_page");
    expect(metrics.dryerSafe.basis).toBe("product_page");
    expect(metrics.wrinkleResistance.basis).toBe("material_inference");
  });

  it("lets the manufacturer's instruction beat the fiber estimate", () => {
    const withoutLabel = evaluateMaterialMetrics(product([{ name: "Polyester", percentage: 100 }]));
    expect(withoutLabel.dryerSafe.score).toBe(100); // fibers alone say polyester is dryer safe
    expect(withoutLabel.dryerSafe.confidence).toBe("low");
    expect(withoutLabel.dryerSafe.note).toContain("소재로 예상");

    const withLabel = evaluateMaterialMetrics(product([{ name: "Polyester", percentage: 100 }], { careInstructions: ["건조기 사용 금지"] }));
    expect(withLabel.dryerSafe.score).toBeLessThan(20);
    expect(withLabel.dryerSafe.confidence).toBe("high");
  });

  it("reads wrinkle statements from the page separately", () => {
    const wrinkly = evaluateMaterialMetrics(product([{ name: "Cotton", percentage: 100 }], { careInstructions: ["구김이 생기기 쉬워 다림질 필요"] }));
    expect(wrinkly.wrinkleResistance.score).toBeLessThan(40);
    const easy = evaluateMaterialMetrics(product([{ name: "Cotton", percentage: 100 }], { careInstructions: ["구김이 적은 논아이론 소재"] }));
    expect(easy.wrinkleResistance.score).toBeGreaterThan(70);
  });

  it("keeps wash, dryer and wrinkle independent in the label reader", () => {
    expect(readCareSignals(["세탁기 가능", "건조기 사용 금지"])).toEqual({ dryer: "forbidden", wash: "machine" });
    expect(readCareSignals(["손세탁", "건조기 사용 가능"])).toEqual({ dryer: "allowed", wash: "hand" });
    expect(readCareSignals(["드라이클리닝"])).toEqual({ wash: "dry_clean" });
    expect(readCareSignals(["드라이클리닝 불가", "세탁기 가능"]).wash).toBe("machine");
    expect(readCareSignals(["Do not tumble dry", "Machine wash cold"])).toMatchObject({ dryer: "forbidden", wash: "machine" });
    expect(readCareSignals(["Do not dry clean"]).dryer).toBeUndefined();
    expect(readCareSignals(undefined)).toEqual({});
  });
});

describe("what is not on the page stays unavailable", () => {
  it("does not invent material metrics without a blend", () => {
    const metrics = evaluateMaterialMetrics(product([]));
    for (const key of ["softness", "warmth", "breathability", "moistureWicking", "durability", "naturalFiberRatio"] as const) {
      expect(metrics[key].available, key).toBe(false);
    }
  });

  it("still reads the care label when there is no blend", () => {
    const metrics = evaluateMaterialMetrics(product([], { careInstructions: ["세탁기 가능", "건조기 사용 금지"] }));
    expect(metrics.washEase.available).toBe(true);
    expect(metrics.dryerSafe.available).toBe(true);
    expect(metrics.warmth.available).toBe(false);
  });

  it("is unavailable when most of the blend is an unknown fiber", () => {
    const metrics = evaluateMaterialMetrics(product([{ name: "Qiviut", percentage: 80 }, { name: "Wool", percentage: 20 }]));
    expect(metrics.warmth.available).toBe(false);
  });

  it("lowers confidence when part of the blend is unknown", () => {
    const metrics = evaluateMaterialMetrics(product([{ name: "Wool", percentage: 65 }, { name: "Qiviut", percentage: 35 }]));
    expect(metrics.warmth.available).toBe(true);
    expect(metrics.warmth.confidence).toBe("low");
  });

  it("caps estimates from fiber properties at medium confidence", () => {
    const metrics = evaluateMaterialMetrics(product([{ name: "Wool", percentage: 100 }]));
    expect(metrics.warmth.confidence).toBe("medium");
  });
});

describe("natural fiber ratio", () => {
  it("is the share of natural fibers in the blend", () => {
    const metrics = evaluateMaterialMetrics(product([{ name: "Wool", percentage: 60 }, { name: "Nylon", percentage: 40 }]));
    expect(metrics.naturalFiberRatio.score).toBe(60);
    expect(evaluateMaterialMetrics(product([{ name: "Linen", percentage: 55 }, { name: "Cotton", percentage: 45 }])).naturalFiberRatio.score).toBe(100);
    expect(evaluateMaterialMetrics(product([{ name: "Polyester", percentage: 100 }])).naturalFiberRatio.score).toBe(0);
  });
});

describe("evaluateProduct", () => {
  it("returns all thirteen metrics", () => {
    const { metrics } = evaluateProduct(demoProduct);
    expect(Object.keys(metrics)).toHaveLength(13);
  });
});
