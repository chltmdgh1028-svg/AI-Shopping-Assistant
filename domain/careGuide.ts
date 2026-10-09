import { parseManufacturerCare } from "@/domain/careSignals";
import { evaluateProduct, type ProductEvaluation } from "@/domain/evaluation";
import { readBlend } from "@/domain/metrics";
import type { CareGuide, InferredCareTip, MaterialEvaluation, ProductFacts } from "@/types/shopping";

const NO_INSTRUCTION = "상품 페이지에 안내가 없어요.";

/**
 * Two lists that never mix. manufacturer is the page's own text, verbatim. inferred is what the app suggests from
 * the fibers, and it only covers what the page says nothing about: it never restates, softens or overrides a
 * label. The verdicts (dryer, washing effort) come from the same canonical metrics the preference list reads.
 */
export function buildCareGuide(product: ProductFacts, material: MaterialEvaluation, evaluation: ProductEvaluation = evaluateProduct(product)): CareGuide {
  const manufacturer = parseManufacturerCare(product.careInstructions);
  const has = (...kinds: string[]) => manufacturer.some((item) => kinds.includes(item.kind));
  const text = (...kinds: string[]) => manufacturer.filter((item) => kinds.includes(item.kind)).map((item) => item.text).join(", ");

  const { washEase, dryerSafe } = evaluation.metrics;
  const fromLabel = (metric: typeof washEase) => metric.available && metric.source === "manufacturer-care";

  const dryer: CareGuide["dryer"] = !fromLabel(dryerSafe) ? "unknown" : dryerSafe.score >= 68 ? "allowed" : "not_recommended";
  const washing_effort: CareGuide["washing_effort"] = !fromLabel(washEase) ? "unknown" : washEase.score >= 75 ? "easy" : washEase.score >= 45 ? "moderate" : "demanding";

  const woolLike = material.traits.warmth >= 4 && material.traits.careEase <= 3;
  const blend = readBlend(product);
  const cellulosic = (blend.classShare("regenerated-cellulosic") ?? 0) >= 30;
  const inferred: InferredCareTip[] = [];

  // Only what the page leaves open. If it prescribes washing or drying, the app adds nothing there.
  if (!has("washing", "dry_clean")) {
    inferred.push({ kind: "washing", text: woolLike ? "찬물 / 울코스 또는 손세탁을 권장해요." : "찬물 세탁을 기본으로 권장해요." });
  }
  if (!has("drying") && dryer === "unknown") {
    inferred.push({ kind: "drying", text: woolLike || cellulosic ? "건조기 사용은 비추천해요." : "낮은 온도 자연 건조가 안전해요." });
  }
  if (cellulosic && !has("wring")) {
    inferred.push({ kind: "shape", text: "비스코스 계열은 젖으면 약해져요. 비틀거나 세게 당기지 말고 눌러서 물기를 빼세요." });
  }
  inferred.push({
    kind: "storage",
    text:
      product.category === "knitwear" || woolLike
        ? "늘어짐을 막으려면 옷걸이보다 접어서 보관하는 편이 좋아요."
        : "통풍이 되는 곳에 걸어 보관하세요.",
  });

  const cautions = manufacturer.filter((item) => ["bleach", "wring", "ironing", "other"].includes(item.kind)).map((item) => item.text);

  return {
    source: manufacturer.length > 0 ? "product_page" : "material_inference",
    washing: has("washing", "dry_clean") ? text("washing", "dry_clean") : (inferred.find((tip) => tip.kind === "washing")?.text ?? NO_INSTRUCTION),
    drying: has("drying") ? text("drying") : (inferred.find((tip) => tip.kind === "drying")?.text ?? NO_INSTRUCTION),
    storage: inferred.find((tip) => tip.kind === "storage")?.text ?? NO_INSTRUCTION,
    cautions,
    manufacturer,
    inferred,
    dryer,
    washing_effort,
  };
}
