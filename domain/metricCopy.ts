import type { MetricKey } from "@/types/shopping";

export type CopyKey = Exclude<MetricKey, "valueForMoney">;

// Default sentence for a metric when nothing more specific is known about this product.
const reasonCopy: Record<CopyKey, { good: string; fair: string; poor: string }> = {
  softness: {
    good: "소재 구성상 부드럽게 느껴질 가능성이 높아요.",
    fair: "촉감은 제품에 따라 차이가 있어 무난한 편이에요.",
    poor: "소재 구성상 까슬거리거나 피부에 거슬릴 수 있어요.",
  },
  lightweight: {
    good: "가벼운 소재 위주라 오래 입어도 부담이 적어요.",
    fair: "무게감은 보통 수준이에요.",
    poor: "소재 구성상 묵직하게 느껴질 수 있어요.",
  },
  warmth: {
    good: "보온성이 좋은 소재 구성이에요.",
    fair: "보온성은 보통 수준이에요.",
    poor: "추운 날 입기엔 보온성이 아쉬울 수 있어요.",
  },
  breathability: {
    good: "공기가 잘 통하는 소재 구성이에요.",
    fair: "통기성은 보통 수준이에요.",
    poor: "소재 구성상 다소 답답하게 느껴질 수 있어요.",
  },
  moistureWicking: {
    good: "땀 배출과 빠른 건조를 기대할 수 있어요.",
    fair: "땀 배출과 건조 속도는 보통 수준으로 봤어요.",
    poor: "땀이 차면 잘 마르지 않을 수 있어요.",
  },
  stretch: {
    good: "잘 늘어나서 움직일 때 편안해요.",
    fair: "신축성은 약간 있는 정도예요.",
    poor: "신축성은 크게 기대하기 어려워요.",
  },
  washEase: {
    good: "집에서 세탁하기 쉬운 편이에요.",
    fair: "세탁할 때 약간의 주의가 필요해요.",
    poor: "세탁이 까다로워 관리에 신경이 필요해요.",
  },
  dryerSafe: {
    good: "건조기를 사용할 수 있는 편이에요.",
    fair: "건조기는 낮은 온도에서만 쓰는 편이 안전해요.",
    poor: "건조기는 사용하지 않는 편이 좋아요.",
  },
  pillingResistance: {
    good: "보풀이 잘 생기지 않는 편이에요.",
    fair: "마찰이 많은 부위에 보풀이 생길 수 있어요.",
    poor: "보풀이 생기기 쉬운 소재 구성이에요.",
  },
  wrinkleResistance: {
    good: "구김이 적은 편이에요.",
    fair: "구김이 약간 생길 수 있어요.",
    poor: "구김이 쉽게 생겨 다림질이 필요할 수 있어요.",
  },
  durability: {
    good: "튼튼한 소재 구성이라 오래 입기 좋아요.",
    fair: "내구성은 보통 수준이에요.",
    poor: "마모나 늘어짐에 약할 수 있어요.",
  },
  naturalFiberRatio: {
    good: "천연 섬유 비중이 높아요.",
    fair: "천연 섬유와 다른 섬유가 섞여 있어요.",
    poor: "천연 섬유는 적어요.",
  },
};

export function tierOf(score: number): "good" | "fair" | "poor" {
  return score >= 68 ? "good" : score >= 48 ? "fair" : "poor";
}

export function tierReason(key: CopyKey, score: number) {
  return reasonCopy[key][tierOf(score)];
}
