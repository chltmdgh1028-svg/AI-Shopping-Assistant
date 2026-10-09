// Reads what the manufacturer's care label / product page says. Washing, drying and wrinkling are read
// separately: "easy to wash but no dryer" is a normal combination and must stay representable.

export type CareSignals = {
  dryer?: "allowed" | "forbidden";
  wash?: "machine" | "machine_gentle" | "gentle" | "hand" | "hand_or_gentle" | "dry_clean";
  wrinkle?: "wrinkles_easily" | "low_maintenance";
};

const dryerForbidden = [
  /건조기[^.,;\n]{0,14}(금지|불가|사용\s*안|피하|사용하지|사용\s*자제)/,
  /(do\s*not|don'?t|never|no)\s+(use\s+)?(a\s+)?(tumble|machine)[\s-]*dry/i,
  /(do\s*not|don'?t|never)\s+(use\s+)?(a\s+)?(clothes\s+)?dryer/i,
  /tumble\s*dry\s*[:-]?\s*(no|not\s+allowed)/i,
];
const dryerAllowed = [/건조기[^.,;\n]{0,14}(가능|사용\s*가능|OK|괜찮)/i, /tumble\s*dry(\s*(low|medium|normal))?/i, /machine\s*dry/i];

const dryCleanNegated = /드라이\s*클리닝?[^.,;\n]{0,6}(불가|금지)|do\s*not\s*dry[\s-]?clean/i;
const dryClean = /드라이\s*클리닝?|드라이크리닝|dry[\s-]?clean/i;
const handWash = /손\s*세탁|hand[\s-]?wash/i;
const handWashNegated = /손\s*세탁[^.,;\n]{0,6}(불가|금지)/;
const machineWash = /세탁기[^.,;\n]{0,10}(가능|사용\s*가능|OK)|machine[\s-]?wash|가정\s*세탁\s*가능/i;
const gentleWash = /울\s*코스|찬물|냉수|wool\s*cycle|delicate|gentle|중성\s*세제|섬세/i;

const wrinklesEasily = /구김[^.,;\n]{0,6}(주의|이\s*생기기\s*쉬|이\s*잘|이\s*쉽)|다림질[^.,;\n]{0,6}(필요|권장|필수)|iron(ing)?\s*(is\s*)?(required|recommended)|wrinkle[\s-]?prone/i;
const lowMaintenance = /구김[^.,;\n]{0,6}(적|없|방지|걱정)|wrinkle[\s-]?(free|resistant)|non[\s-]?iron|논\s*아이론|노\s*다림질/i;

export function readCareSignals(lines: string[] | undefined): CareSignals {
  const text = (lines ?? []).join(" ").trim();
  if (!text) return {};
  const signals: CareSignals = {};

  if (dryerForbidden.some((pattern) => pattern.test(text))) signals.dryer = "forbidden";
  else if (dryerAllowed.some((pattern) => pattern.test(text))) signals.dryer = "allowed";

  const hand = handWash.test(text) && !handWashNegated.test(text);
  const gentle = gentleWash.test(text);
  const machine = machineWash.test(text);
  if (dryClean.test(text) && !dryCleanNegated.test(text) && !machine) signals.wash = "dry_clean";
  else if (hand && gentle) signals.wash = "hand_or_gentle";
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
