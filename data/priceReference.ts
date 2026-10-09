import type { ProductFacts } from "@/types/shopping";

// Rough reference points for "가격 대비 구성". There is no market-wide price data behind this app, so these
// are deliberately coarse, editable constants, not quotes. They only say what a plain garment of that kind,
// made of the cheapest common fiber (polyester), tends to cost; the fiber blend scales it up.
// The result is shown as a reference estimate (never "high" confidence), and only for currencies listed here.

type Category = Exclude<ProductFacts["category"], "unknown">;

export const baselinePrice: Record<string, Record<Category, number>> = {
  KRW: { knitwear: 45_000, shirt: 35_000, pants: 40_000, outerwear: 80_000, dress: 50_000 },
  USD: { knitwear: 35, shirt: 28, pants: 32, outerwear: 65, dress: 40 },
};

// Relative raw-material cost of a fiber, with polyester = 1.
export const fiberCostFactor: Record<string, number> = {
  polyester: 1,
  acrylic: 1.1,
  nylon: 1.4,
  spandex: 1.4,
  cotton: 1.6,
  linen: 2,
  wool: 2.6,
  cashmere: 6,
};

// price / expected-price  ->  score. Linear between points; clamped at both ends.
export const priceRatioCurve: Array<[ratio: number, score: number]> = [
  [0.5, 90],
  [0.8, 82],
  [1.0, 70],
  [1.3, 52],
  [1.7, 34],
  [2.4, 18],
];
