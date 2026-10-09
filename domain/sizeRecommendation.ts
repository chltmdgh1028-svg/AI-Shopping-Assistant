import type { ProductFacts, ProductSize, SizeRecommendation, UserProfile } from "@/types/shopping";

function targetChestEase(preferredFit: UserProfile["preferredFit"]) {
  if (preferredFit === "slim") return 8;
  if (preferredFit === "regular") return 12;
  if (preferredFit === "relaxed") return 18;
  return 24;
}

function estimateChest(profile: UserProfile) {
  if (profile.chestCm) return { value: profile.chestCm, measured: true };
  const base = profile.gender === "male" ? 0.54 : 0.5;
  return { value: Math.round(profile.heightCm * base + profile.weightKg * 0.18), measured: false };
}

function findClosestSize(sizes: ProductSize[], targetChest: number) {
  const withChest = sizes.filter((size) => typeof size.chest === "number");
  if (withChest.length === 0) return undefined;
  return withChest.reduce((best, size) => {
    const currentGap = Math.abs((size.chest ?? 0) - targetChest);
    const bestGap = Math.abs((best.chest ?? 0) - targetChest);
    return currentGap < bestGap ? size : best;
  }, withChest[0]);
}

export function recommendSize(profile: UserProfile, product: ProductFacts): SizeRecommendation {
  if (product.sizes.length === 0) {
    return {
      alternatives: [],
      confidence: "unavailable",
      reason: "상품 페이지에서 사이즈표를 확인하지 못했습니다. 사이즈를 임의로 만들지 않았어요.",
    };
  }

  const chest = estimateChest(profile);
  const targetChest = chest.value + targetChestEase(profile.preferredFit);
  const recommended = findClosestSize(product.sizes, targetChest);

  if (!recommended) {
    return {
      alternatives: product.sizes.map((size) => size.name),
      confidence: "low",
      reason: "사이즈명은 있지만 가슴둘레 같은 비교 치수가 없어 추천 신뢰도가 낮아요.",
    };
  }

  const index = product.sizes.findIndex((size) => size.name === recommended.name);
  const alternatives = [
    product.sizes[index - 1]?.name,
    product.sizes[index + 1]?.name,
  ].filter(Boolean) as string[];

  const confidence = chest.measured && profile.shoulderCm ? "high" : chest.measured ? "medium" : "low";
  const reason =
    confidence === "high"
      ? "가슴둘레와 어깨너비를 함께 비교해 추천 신뢰도가 높아요."
      : confidence === "medium"
        ? "실측 가슴둘레는 있지만 어깨너비가 없어 신뢰도는 보통이에요."
        : "키와 몸무게 기반 추정이라 정확도가 제한됩니다. 가슴둘레를 입력하면 더 정확해져요.";

  return {
    recommendedSize: recommended.name,
    alternatives,
    confidence,
    reason,
  };
}
