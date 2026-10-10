import { garmentTypeOf } from "@/domain/garment";
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

  const garment = garmentTypeOf(product.category, product.sizes);
  if (garment === "bottom" || garment === "skirt") return recommendWaist(profile, product);

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
        : "키와 몸무게로 추정한 값이라 확정하기 어려워요. 가슴둘레, 어깨너비, 평소 잘 맞는 옷의 실측을 입력하면 정확해져요.";

  // With only height and weight to go on, one confident size would overstate what is known. Show where each fit points.
  const fitCandidates =
    confidence === "low"
      ? {
          regular: findClosestSize(product.sizes, chest.value + targetChestEase("regular"))?.name,
          relaxed: findClosestSize(product.sizes, chest.value + targetChestEase("oversized"))?.name,
        }
      : undefined;

  return {
    recommendedSize: recommended.name,
    alternatives,
    confidence,
    reason,
    basis: chest.measured ? "measured" : "estimated",
    fitCandidates,
  };
}

// Slack room for a waistband: how much bigger than the body the garment's waist circumference should be.
const waistEase = { slim: 0, regular: 2, relaxed: 4, oversized: 6 } as const;

/**
 * Trousers and skirts fit at the waist, not the chest. Height and weight say little about a waist, so without a measured
 * waist there is no recommendation, only the sizes and an invitation to enter it.
 */
function recommendWaist(profile: UserProfile, product: ProductFacts): SizeRecommendation {
  const withWaist = product.sizes.filter((size) => typeof size.waist === "number");
  const names = product.sizes.map((size) => size.name);

  if (withWaist.length === 0) {
    return { alternatives: names, confidence: "low", reason: "사이즈표에 허리 치수가 없어 추천 신뢰도가 낮아요. 상품 페이지의 실측을 한 번 더 확인하세요." };
  }
  if (!profile.waistCm) {
    return {
      alternatives: names,
      confidence: "low",
      basis: "estimated",
      reason: "허리둘레를 입력하지 않아 사이즈를 정하기 어려워요. 허리둘레를 입력하면 이 사이즈표와 비교해 추천해 드려요.",
    };
  }

  const target = profile.waistCm + waistEase[profile.preferredFit];
  const recommended = withWaist.reduce((best, size) => (Math.abs((size.waist ?? 0) - target) < Math.abs((best.waist ?? 0) - target) ? size : best), withWaist[0]);
  const index = product.sizes.findIndex((size) => size.name === recommended.name);

  return {
    recommendedSize: recommended.name,
    alternatives: [product.sizes[index - 1]?.name, product.sizes[index + 1]?.name].filter(Boolean) as string[],
    confidence: "medium",
    basis: "measured",
    reason: "실측 허리둘레를 사이즈표의 허리 치수와 비교했어요. 엉덩이·허벅지 치수는 비교하지 않아 신뢰도는 보통이에요.",
  };
}
