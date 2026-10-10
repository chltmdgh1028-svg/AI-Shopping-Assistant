import type { Measure } from "@/domain/sizeMeasurements";
import type { ProductFacts, ProductSize } from "@/types/shopping";

export type GarmentType = "top" | "bottom" | "onepiece" | "skirt" | "outer";

/** Which measurements say whether a garment of this kind fits, most important first. */
export const garmentMeasures: Record<GarmentType, Measure[]> = {
  top: ["shoulder", "chest", "sleeve", "length"],
  bottom: ["waist", "hip", "thigh", "rise", "hem", "length"],
  onepiece: ["shoulder", "chest", "waist", "hip", "sleeve", "length"],
  skirt: ["waist", "hip", "length", "hem"],
  outer: ["shoulder", "chest", "sleeve", "length"],
};

type Category = ProductFacts["category"];

// Order matters: the garment noun wins over its material or style word: "데님 스커트" is a skirt, "니트 원피스" a dress, "데님 자켓" a jacket.
const categoryRules: Array<[Category, RegExp]> = [
  ["dress", /dress|원피스/i],
  ["skirt", /skirt|스커트|치마/i],
  ["outerwear", /coat|jacket|outer|코트|자켓|재킷|아우터|점퍼|패딩|야상|집업|블루종|무스탕/i],
  ["pants", /pants|trouser|jean|슬랙스|팬츠|바지|데님|레깅스|조거|반바지/i],
  ["knitwear", /knit|sweater|cardigan|니트|가디건/i],
  ["top", /t-?shirt|\btee\b|티셔츠|맨투맨|후드|스웨트|나시|탑|폴로|크롭|카라\s*티/i],
  ["shirt", /shirt|셔츠|블라우스|남방/i],
];

/** The product kind from its name and category text. "unknown" only when nothing in the text says. */
export function categorizeProduct(text: string): Category {
  return categoryRules.find(([, pattern]) => pattern.test(text))?.[0] ?? "unknown";
}

const fromCategory: Record<Exclude<Category, "unknown">, GarmentType> = {
  knitwear: "top",
  shirt: "top",
  top: "top",
  pants: "bottom",
  dress: "onepiece",
  skirt: "skirt",
  outerwear: "outer",
};

/**
 * What kind of garment the size table describes. The product's category wins; when it is unknown the table itself
 * decides (a waist, thigh or rise column means trousers, a chest column means a top).
 */
export function garmentTypeOf(category: Category, sizes: ProductSize[] = []): GarmentType | undefined {
  if (category !== "unknown") return fromCategory[category];
  if (sizes.some((size) => size.rise !== undefined || size.thigh !== undefined)) return "bottom";
  if (sizes.some((size) => size.chest !== undefined)) return "top";
  if (sizes.some((size) => size.waist !== undefined || size.hip !== undefined)) return "bottom";
  return undefined;
}
