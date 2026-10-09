import type { CareGuide, MaterialEvaluation, ProductFacts } from "@/types/shopping";

export function buildCareGuide(product: ProductFacts, material: MaterialEvaluation): CareGuide {
  if (product.careInstructions && product.careInstructions.length > 0) {
    return {
      source: "product_page",
      washing: product.careInstructions.find((item) => item.includes("세탁")) ?? "상품 페이지 관리 정보를 우선 확인하세요.",
      drying: product.careInstructions.find((item) => item.includes("건조")) ?? "건조 방법은 상품 페이지의 세탁 라벨을 확인하세요.",
      storage: "형태 유지를 위해 접어서 보관하거나 두꺼운 옷걸이를 사용하세요.",
      cautions: product.careInstructions.filter((item) => item.includes("주의") || item.includes("금지")),
    };
  }

  const woolLike = material.traits.warmth >= 4 && material.traits.careEase <= 3;
  return {
    source: "material_inference",
    washing: woolLike ? "찬물 / 울코스 또는 손세탁을 권장해요." : "찬물 세탁을 기본으로 권장해요.",
    drying: woolLike ? "건조기 사용은 비추천해요." : "낮은 온도 자연 건조가 안전해요.",
    storage: woolLike ? "늘어짐 방지를 위해 접어서 보관하는 편이 좋아요." : "통풍이 되는 곳에 보관하세요.",
    cautions: ["제조사 세탁 라벨이 없을 때의 소재 기반 일반 권장사항입니다."],
  };
}
