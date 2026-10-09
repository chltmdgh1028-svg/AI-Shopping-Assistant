import { describe, expect, it } from "vitest";
import { evaluateProduct } from "@/domain/evaluation";
import { parseManualText } from "@/services/productParser";

const pasted = [
  "[1+1] 더 멋진 카라 니트",
  "1+1 행사 상품, 2개 구성으로 발송됩니다.",
  "현재 판매가 59,900원 정가 69,500원",
  "Viscose 50% Polyester 30% Nylon 20%",
  "세탁: 단독 손세탁",
  "건조: 그늘에 건조",
  "비틀기 금지",
  "표백 금지",
].join("\n");

describe("pasted product description", () => {
  const product = parseManualText(pasted);

  it("reads every fiber the app knows, each with its own share", () => {
    expect(product.materials.map((item) => `${item.name} ${item.percentage}`).sort()).toEqual(["Nylon 20", "Polyester 30", "Viscose 50"]);
  });

  it("keeps all the care instructions, including bleach and wringing", () => {
    expect(product.careInstructions).toEqual(["세탁: 단독 손세탁", "건조: 그늘에 건조", "비틀기 금지", "표백 금지"]);
  });

  it("confirms the bundle from the pasted text and prices one piece", () => {
    expect(product.pricing).toMatchObject({ currentPrice: 59900, originalPrice: 69500, bundleQuantity: 2, unitPrice: 29950 });
  });

  it("evaluates with the label first: no dryer, no easy wash", () => {
    const { metrics } = evaluateProduct(product);
    expect(metrics.dryerSafe.score).toBeLessThan(20);
    expect(metrics.washEase.score).toBeLessThan(48);
  });

  it("reads a percentage written before the fiber, too", () => {
    expect(parseManualText("울 니트\n30% 나일론 70% 울").materials.map((item) => item.name).sort()).toEqual(["Nylon", "Wool"]);
  });
});
