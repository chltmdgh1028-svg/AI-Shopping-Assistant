// Reads what the manufacturer's care label / product page says. Washing, drying and wrinkling are read
// separately: "easy to wash but no dryer" is a normal combination and must stay representable.

import type { CareKind, ManufacturerCareItem } from "@/types/shopping";

export type CareSignals = {
  /** natural_only: the label says to dry in shade / flat / on a line without mentioning a dryer. */
  dryer?: "allowed" | "forbidden" | "natural_only";
  wash?: "machine" | "machine_gentle" | "gentle" | "hand" | "hand_or_gentle" | "dry_clean";
  wrinkle?: "wrinkles_easily" | "low_maintenance";
};

const dryerForbidden = [
  /건조기[^.,;\n]{0,14}(금지|불가|사용\s*안|피하|사용하지|사용\s*자제)/,
  /(do\s*not|don'?t|never|no)\s+(use\s+)?(a\s+)?(tumble|machine)[\s-]*dry/i,
  /(do\s*not|don'?t|never)\s+(use\s+)?(a\s+)?(clothes\s+)?dryer/i,
  /tumble\s*dry\s*[:-]?\s*(no|not\s+allowed)/i,
];
// "그늘에 건조", "자연 건조", "눕혀서 말리기": the label prescribes how to dry and leaves the machine out.
// A manufacturer who tells you to dry flat is not recommending the dryer, whatever the fiber would allow.
const naturalDry = [
  /그늘[^.,;\n]{0,8}(건조|말리|말려|세워)/,
  /자연\s*건조|음\s*건/,
  /(눕혀|평평|펴서|펼쳐)[^.,;\n]{0,10}(건조|말리|말려)/,
  /(line|air|drip|shade)[\s-]*dry|dry\s*(flat|in\s*(the\s*)?shade)|hang\s*(to\s*)?dry|flat\s*dry/i,
];
const dryerAllowed = [/건조기[^.,;\n]{0,14}(가능|사용\s*가능|OK|괜찮)/i, /tumble\s*dry(\s*(low|medium|normal))?/i, /machine\s*dry/i];

const dryCleanNegated = /드라이\s*클리닝?[^.,;\n]{0,6}(불가|금지)|do\s*not\s*dry[\s-]?clean/i;
const dryClean = /드라이\s*클리닝?|드라이크리닝|dry[\s-]?clean/i;
const handWash = /손\s*세탁|hand[\s-]?wash/i;
const handWashNegated = /손\s*세탁[^.,;\n]{0,6}(불가|금지)/;
const machineWash = /세탁기[^.,;\n]{0,10}(가능|사용\s*가능|OK)|machine[\s-]?wash|가정\s*세탁\s*가능/i;
const gentleWash = /울\s*코스|찬물|냉수|wool\s*cycle|delicate|gentle|중성\s*세제|섬세/i;
// A machine cycle, as opposed to a gentle detergent: "손세탁 또는 울코스" offers a machine, "손세탁 중성세제" does not.
const gentleCycle = /울\s*코스|wool\s*cycle|delicate\s*cycle|약한?\s*코스|섬세\s*코스/i;

const wrinklesEasily = /구김[^.,;\n]{0,6}(주의|이\s*생기기\s*쉬|이\s*잘|이\s*쉽)|다림질[^.,;\n]{0,6}(필요|권장|필수)|iron(ing)?\s*(is\s*)?(required|recommended)|wrinkle[\s-]?prone/i;
const lowMaintenance = /구김[^.,;\n]{0,6}(적|없|방지|걱정)|wrinkle[\s-]?(free|resistant)|non[\s-]?iron|논\s*아이론|노\s*다림질/i;

export function readCareSignals(lines: string[] | undefined): CareSignals {
  const text = (lines ?? []).join(" ").trim();
  if (!text) return {};
  const signals: CareSignals = {};

  if (dryerForbidden.some((pattern) => pattern.test(text))) signals.dryer = "forbidden";
  else if (dryerAllowed.some((pattern) => pattern.test(text))) signals.dryer = "allowed";
  else if (naturalDry.some((pattern) => pattern.test(text))) signals.dryer = "natural_only";

  const hand = handWash.test(text) && !handWashNegated.test(text);
  const gentle = gentleWash.test(text);
  const machine = machineWash.test(text);
  if (dryClean.test(text) && !dryCleanNegated.test(text) && !machine) signals.wash = "dry_clean";
  else if (hand && (gentleCycle.test(text) || machine)) signals.wash = "hand_or_gentle";
  else if (hand) signals.wash = "hand";
  else if (machine && gentle) signals.wash = "machine_gentle";
  else if (machine) signals.wash = "machine";
  else if (gentle) signals.wash = "gentle";

  if (wrinklesEasily.test(text)) signals.wrinkle = "wrinkles_easily";
  else if (lowMaintenance.test(text)) signals.wrinkle = "low_maintenance";

  return signals;
}

/** 0-100: how easy the label says it is to wash at home. */
export const washScore: Record<NonNullable<CareSignals["wash"]>, number> = {
  machine: 88,
  machine_gentle: 78,
  gentle: 62,
  hand_or_gentle: 45,
  hand: 35,
  dry_clean: 18,
};

const bleachRule = /표백|bleach/i;
const wringRule = /비틀|짜지|짜는|wring/i;
const ironRule = /다림질|아이론|iron/i;
const dryCleanRule = /드라이\s*클리닝?|드라이크리닝|dry[\s-]?clean/i;
const dryRule = /건조|말리|말려|\bdry\b|tumble/i;
const washRule = /세탁|빨래|손빨|wash|laund/i;

function careKind(segment: string): CareKind {
  if (bleachRule.test(segment)) return "bleach";
  if (wringRule.test(segment)) return "wring";
  if (ironRule.test(segment)) return "ironing";
  if (dryCleanRule.test(segment)) return "dry_clean";
  if (dryRule.test(segment) && !washRule.test(segment)) return "drying";
  if (washRule.test(segment)) return "washing";
  if (dryRule.test(segment)) return "drying";
  return "other";
}

/**
 * The care instructions exactly as the page states them, sorted by what they are about. Nothing here is
 * generated: it is the product page's own text, so the UI may call it "상품 페이지 안내".
 */
export function parseManufacturerCare(lines: string[] | undefined): ManufacturerCareItem[] {
  const items: ManufacturerCareItem[] = [];
  const seen = new Set<string>();

  for (const line of lines ?? []) {
    for (const segment of line.split(/[;\n]/)) {
      // "찬물 손세탁, 그늘 건조" is two instructions; "30도 이하, 단독 손세탁" is one. Split only when both are present.
      const parts = washRule.test(segment) && dryRule.test(segment) && segment.includes(",") ? segment.split(",") : [segment];
      for (const part of parts) {
        const text = part.replace(/^[\s\-•·*]+/, "").trim();
        if (text.length < 2 || seen.has(text)) continue;
        seen.add(text);
        items.push({ kind: careKind(text), text });
      }
    }
  }
  return items;
}

/** Explicit functional claims on the page. A blend alone never counts as one. */
export type FeatureClaims = { antiPilling: boolean; fastDry: boolean };

const antiPillingClaim = /보풀\s*(방지|억제|적은|걱정\s*없|잘\s*안)|필링\s*(방지|가공|걱정)|anti[\s-]?pill|pill[\s-]?resistant/i;
const fastDryClaim = /속건|흡한|빠르게\s*(마르|건조)|quick[\s-]?dry|fast[\s-]?dry|moisture[\s-]?wick|wicking/i;

export function readFeatureClaims(text: string): FeatureClaims {
  return { antiPilling: antiPillingClaim.test(text), fastDry: fastDryClaim.test(text) };
}
