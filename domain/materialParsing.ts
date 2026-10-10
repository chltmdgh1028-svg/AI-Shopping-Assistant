import { materialKnowledge } from "@/data/materials";
import type { ExtractionConfidence, ExtractionSource, MaterialBlend } from "@/types/shopping";

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Hit = { index: number; blend: MaterialBlend };

function findShares(text: string, source: ExtractionSource, confidence: ExtractionConfidence, reverse: boolean): Hit[] {
  return Object.entries(materialKnowledge).flatMap(([key, knowledge]): Hit[] => {
    const names = [...knowledge.aliases].sort((a, b) => b.length - a.length).map(escapeRegExp).join("|");
    const pattern = reverse ? `(\\d{1,3})(?:\\.\\d+)?\\s*%\\s*(?:${names})` : `(?:${names})\\s*[:：]?\\s*(\\d{1,3})(?:\\.\\d+)?\\s*%`;
    const match = new RegExp(pattern, "i").exec(text);
    const percentage = Number(match?.[1]);
    if (!match || !(percentage > 0 && percentage <= 100)) return [];
    const name = knowledge.displayName ?? key.charAt(0).toUpperCase() + key.slice(1);
    return [{ index: match.index, blend: { name, percentage, source, confidence } }];
  });
}

/**
 * Fiber shares written in free text, for every fiber the app knows by any of its names: "Wool 60%", "울 60%",
 * and "60% Wool" when that reads more of the blend. Each fiber is read once, and the result follows the
 * order the page wrote them in. Anything that is not on the page is not returned.
 */
export function readMaterialShares(text: string, source: ExtractionSource, confidence: ExtractionConfidence): MaterialBlend[] {
  const forward = findShares(text, source, confidence, false);
  const reversed = findShares(text, source, confidence, true);
  // A page writes its blend in one style. When both readings find something, the one that explains more fibers wins.
  const hits = reversed.length > forward.length ? reversed : forward;
  return hits.sort((a, b) => a.index - b.index).map((hit) => hit.blend);
}
