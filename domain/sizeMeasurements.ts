import type { ExtractionConfidence } from "@/types/shopping";

/** Every measurement a garment size table can hold. Which ones matter depends on the garment (see garment.ts). */
export type Measure = "shoulder" | "chest" | "waist" | "hip" | "length" | "sleeve" | "thigh" | "rise" | "hem" | "armhole";

/** Measurements a shop may list as a laid-flat width ("단면") instead of a circumference. */
export const widthMeasures = ["chest", "waist", "hip", "thigh", "hem"] as const;
export type WidthMeasure = (typeof widthMeasures)[number];
export const isWidthMeasure = (measure: Measure): measure is WidthMeasure => (widthMeasures as readonly string[]).includes(measure);

export type WidthLabel = "flat" | "circumference" | "unknown";

// Plausible numbers in cm for an adult garment, as a laid-flat width and as a full circumference. The ranges overlap in a
// band; a number in that band cannot be told apart without a label, and is then left exactly as printed.
const ranges: Record<WidthMeasure, { flat: [number, number]; circumference: [number, number] }> = {
  chest: { flat: [25, 85], circumference: [70, 190] },
  waist: { flat: [22, 65], circumference: [50, 130] },
  hip: { flat: [30, 80], circumference: [70, 150] },
  thigh: { flat: [15, 45], circumference: [35, 90] },
  hem: { flat: [10, 40], circumference: [20, 80] },
};

// The hem of a top, a dress or a skirt is as wide as the body (45-70cm flat); the hem of trousers is a leg opening (10-40cm).
const bodyHem = { flat: [25, 90], circumference: [50, 200] } as const;

export type WidthReading = {
  value: number;
  /** True when the printed number was doubled from a laid-flat width to a circumference. */
  converted: boolean;
  confidence: ExtractionConfidence;
  note?: string;
};

/**
 * Turns one printed width into a circumference only when the evidence supports it:
 *  - labelled "단면" and small enough to be a flat width: doubled.
 *  - labelled "단면" but too large to be one (the seller typed a circumference): used as written.
 *  - unlabelled: doubled only if it is too small to be a circumference; too large to be flat: as written;
 *    in the overlapping band: as written, with low confidence.
 * Nothing is ever doubled just because it is a width measure.
 */
export function interpretWidth(measure: WidthMeasure, printed: number, label: WidthLabel, options: { bodyHem?: boolean } = {}): WidthReading {
  const { flat, circumference } = measure === "hem" && options.bodyHem ? bodyHem : ranges[measure];
  const canBeFlat = printed <= flat[1];
  const canBeCircumference = printed >= circumference[0];

  if (label === "circumference") return { value: printed, converted: false, confidence: "high" };

  if (label === "flat") {
    if (canBeFlat) return { value: round(printed * 2), converted: true, confidence: "high" };
    return { value: printed, converted: false, confidence: "low", note: "단면이라고 적혀 있지만 값이 커서 둘레 치수로 보고 그대로 사용했어요." };
  }

  if (canBeFlat && !canBeCircumference) return { value: round(printed * 2), converted: true, confidence: "medium", note: "단면 치수로 보고 둘레로 환산했어요." };
  if (!canBeFlat) return { value: printed, converted: false, confidence: "medium" };
  return { value: printed, converted: false, confidence: "low", note: "단면인지 둘레인지 표시가 없어 적힌 그대로 사용했어요." };
}

const round = (value: number) => Math.round(value * 10) / 10;
