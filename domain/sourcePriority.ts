import type { EvidenceSource, MetricResult } from "@/types/shopping";

/**
 * Strongest evidence first. When two sources answer the same question differently, the earlier one wins:
 * a care label that says "dry in shade" beats "polyester dries fast", an explicit blend beats a guess.
 */
export const sourcePriority: readonly EvidenceSource[] = [
  "manufacturer-care", // 1. the manufacturer / product page says it outright
  "product-page", // 1. other explicit statements on the page
  "structured-data", // 2. JSON-LD / meta
  "ai-extraction", // 3. read from the page text by the model and checked against it
  "image-vision", // 3. read from a detail-page image by a vision model: plausibility-checked only
  "material-knowledge", // 4. general knowledge about the fibers
  "generic", // 5. nothing specific: a neutral fallback
];

const rank = (source: EvidenceSource | undefined) => {
  const index = source ? sourcePriority.indexOf(source) : -1;
  return index === -1 ? sourcePriority.length : index;
};

/** The available candidate with the strongest source. Ties keep the order given. */
export function pickBySource(candidates: Array<MetricResult | undefined>): MetricResult | undefined {
  return candidates
    .filter((candidate): candidate is MetricResult => Boolean(candidate?.available))
    .reduce<MetricResult | undefined>((best, candidate) => (best === undefined || rank(candidate.source) < rank(best.source) ? candidate : best), undefined);
}
