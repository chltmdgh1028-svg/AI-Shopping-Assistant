import { describe, expect, it } from "vitest";
import { demoProduct } from "@/data/demoProduct";
import { evaluateProduct } from "@/domain/evaluation";
import { evaluateMaterialMetrics } from "@/domain/metrics";
import { buildPricing } from "@/domain/pricing";
import { evaluateValueForMoney, VALUE_CAVEAT } from "@/domain/valueForMoney";
import type { MaterialBlend, ProductFacts } from "@/types/shopping";

const priced = (currentPrice: number, overrides: Partial<ProductFacts> = {}, originalPrice?: number, currency = "KRW"): ProductFacts => ({
  ...demoProduct,
  pricing: buildPricing({ currentPrice, originalPrice, currency, source: "structured-data", confidence: "high" }),
  ...overrides,
});

const woolBlend: MaterialBlend[] = [
  { name: "Wool", percentage: 60 },
  { name: "Nylon", percentage: 25 },
  { name: "Acrylic", percentage: 15 },
];

const value = (product: ProductFacts) => evaluateValueForMoney(product, evaluateMaterialMetrics(product));

describe("valueForMoney needs a price and a blend", () => {
  it("is unavailable without a price, with the plain-language reason", () => {
    const result = value({ ...demoProduct, pricing: undefined });
    expect(result.status).toBe("unavailable");
    expect(result.unavailableReason).toBe("no_price");
    expect(result.label).toBe("판단 어려움");
    expect(result.summary).toBe("가격이나 소재 정보가 부족해 가격 대비 가치를 판단하기 어려워요.");
    expect(result.score).toBeUndefined();
  });

  it("is unavailable without enough known fibers", () => {
    expect(value(priced(59000, { materials: [] })).unavailableReason).toBe("no_materials");
    expect(value(priced(59000, { materials: [{ name: "Qiviut", percentage: 100 }] })).unavailableReason).toBe("no_materials");
  });

  it("is unavailable for a currency or category it has no reference for", () => {
    expect(value(priced(59, {}, undefined, "EUR")).unavailableReason).toBe("unsupported_currency");
    expect(value(priced(59000, { category: "unknown" })).unavailableReason).toBe("unknown_category");
  });

  it("always carries the caveat about what it cannot see", () => {
    expect(value(priced(59000)).caveat).toBe(VALUE_CAVEAT);
    expect(value({ ...demoProduct, pricing: undefined }).caveat).toContain("브랜드");
  });
});

describe("valueForMoney is judged against price, not against durability", () => {
  it("changes with the price while the blend and durability stay the same", () => {
    const cheap = value(priced(49000));
    const fair = value(priced(95000));
    const dear = value(priced(180000));
    expect(cheap.score!).toBeGreaterThan(fair.score!);
    expect(fair.score!).toBeGreaterThan(dear.score!);

    const durability = (product: ProductFacts) => evaluateMaterialMetrics(product).durability.score;
    expect(durability(priced(49000))).toBe(durability(priced(180000)));
  });

  it("is not simply the durability metric", () => {
    const { metrics } = evaluateProduct(priced(59000));
    expect(metrics.valueForMoney.score).not.toBe(metrics.durability.score);
  });

  it("rates a pricey cheap-fiber garment worse than the same price on a richer blend", () => {
    const price = 90000;
    const polyester = value(priced(price, { materials: [{ name: "Polyester", percentage: 100 }] }));
    const cashmere = value(priced(price, { materials: [{ name: "Cashmere", percentage: 100 }] }));
    expect(cashmere.score!).toBeGreaterThan(polyester.score!);
  });

  it("judges the price actually paid: a bigger discount at the same current price changes nothing", () => {
    const small = value(priced(59000, {}, 62000));
    const big = value(priced(59000, {}, 190000));
    expect(small.score).toBe(big.score);
    expect(small.expectedPrice).toBe(big.expectedPrice);
  });

  it("uses the sale price, so the same list price at a lower sale price scores higher", () => {
    expect(value(priced(59000, {}, 120000)).score!).toBeGreaterThan(value(priced(110000, {}, 120000)).score!);
  });

  it("supports USD", () => {
    const result = value(priced(70, {}, undefined, "USD"));
    expect(result.status).toBe("available");
  });
});

describe("labels and confidence never overclaim", () => {
  it("never reports high confidence: it compares against reference points, not market data", () => {
    for (const price of [30000, 59000, 95000, 200000]) {
      expect(value(priced(price)).confidence).not.toBe("high");
    }
  });

  it("drops to low confidence when the price itself is weak", () => {
    const weak = { ...demoProduct, pricing: buildPricing({ currentPrice: 59000, currency: "KRW", source: "page", confidence: "low" }) };
    expect(value(weak).confidence).toBe("low");
  });

  it("maps score ranges to the three wordings", () => {
    const good = value(priced(59000));
    expect(good.label).toBe("가성비 좋음");
    expect(good.summary).toBe("현재 가격을 고려하면 소재 구성과 기능이 괜찮은 편이에요.");

    const middle = value(priced(105000));
    expect(middle.label).toBe("가성비 보통");
    expect(middle.summary).toBe("가격 대비 구성은 무난해요.");

    const poor = value(priced(210000));
    expect(poor.label).toBe("가성비 아쉬움");
  });

  it("never claims certainty in its wording", () => {
    for (const price of [30000, 59000, 105000, 210000]) {
      const result = value(priced(price));
      expect(`${result.summary} ${result.caveat}`).not.toMatch(/100%|확실|반드시|무조건/);
    }
  });

  it("exposes the reference price so the UI can show its basis", () => {
    const result = value({ ...demoProduct, materials: woolBlend, pricing: priced(59000).pricing });
    expect(result.expectedPrice).toBeGreaterThan(80000);
    expect(result.expectedPrice).toBeLessThan(110000);
  });
});
