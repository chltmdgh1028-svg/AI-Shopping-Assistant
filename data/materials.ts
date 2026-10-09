import type { MaterialTrait, TraitScore } from "@/types/shopping";

export type MaterialKnowledge = {
  aliases: string[];
  traits: Record<MaterialTrait, TraitScore>;
  pros: string[];
  cons: string[];
  careHints: string[];
};

export const materialKnowledge: Record<string, MaterialKnowledge> = {
  wool: {
    aliases: ["wool", "울", "양모"],
    traits: { warmth: 5, softness: 3, breathability: 4, durability: 3, pillingRisk: 3, careEase: 2, stretch: 2, weight: 3, naturalness: 5 },
    pros: ["보온성이 좋아요.", "습도 조절에 유리해요.", "겨울 니트에 잘 맞아요."],
    cons: ["제품에 따라 까슬거릴 수 있어요.", "세탁과 건조에 주의가 필요해요."],
    careHints: ["찬물 또는 울코스를 권장해요.", "건조기는 피하는 편이 좋아요."],
  },
  nylon: {
    aliases: ["nylon", "나일론"],
    traits: { warmth: 2, softness: 3, breathability: 2, durability: 5, pillingRisk: 2, careEase: 4, stretch: 3, weight: 4, naturalness: 1 },
    pros: ["내구성을 보완해요.", "형태 유지에 도움이 돼요.", "비교적 가벼워요."],
    cons: ["통기성은 천연 섬유보다 낮을 수 있어요."],
    careHints: ["고온 건조는 형태 변형을 만들 수 있어요."],
  },
  acrylic: {
    aliases: ["acrylic", "아크릴"],
    traits: { warmth: 3, softness: 3, breathability: 2, durability: 3, pillingRisk: 4, careEase: 4, stretch: 2, weight: 4, naturalness: 1 },
    pros: ["가볍고 비교적 합리적인 가격대에 잘 쓰여요.", "울의 부피감을 보완할 수 있어요."],
    cons: ["마찰이 많은 부위에 보풀이 생길 수 있어요.", "고급스러운 촉감은 제품 차이가 커요."],
    careHints: ["뒤집어서 세탁하면 표면 손상을 줄일 수 있어요."],
  },
  cotton: {
    aliases: ["cotton", "면", "코튼"],
    traits: { warmth: 2, softness: 4, breathability: 5, durability: 3, pillingRisk: 2, careEase: 4, stretch: 2, weight: 3, naturalness: 5 },
    pros: ["피부에 편안한 편이에요.", "통기성이 좋아요.", "세탁 접근성이 좋아요."],
    cons: ["건조가 느릴 수 있어요.", "구김이 생기기 쉬워요."],
    careHints: ["수축 방지를 위해 낮은 온도 세탁을 권장해요."],
  },
  polyester: {
    aliases: ["polyester", "폴리에스터", "폴리"],
    traits: { warmth: 2, softness: 3, breathability: 2, durability: 4, pillingRisk: 3, careEase: 5, stretch: 3, weight: 4, naturalness: 1 },
    pros: ["세탁과 건조가 편한 편이에요.", "구김이 적고 형태 유지가 쉬워요."],
    cons: ["땀이 차면 답답하게 느낄 수 있어요."],
    careHints: ["고온 다림질은 피하세요."],
  },
  cashmere: {
    aliases: ["cashmere", "캐시미어"],
    traits: { warmth: 5, softness: 5, breathability: 4, durability: 2, pillingRisk: 3, careEase: 1, stretch: 2, weight: 5, naturalness: 5 },
    pros: ["가볍고 따뜻해요.", "촉감이 매우 부드러운 편이에요."],
    cons: ["마찰과 세탁에 섬세한 관리가 필요해요.", "보풀 관리가 필요할 수 있어요."],
    careHints: ["가능하면 드라이클리닝 또는 손세탁을 권장해요."],
  },
  spandex: {
    aliases: ["spandex", "elastane", "polyurethane", "스판", "폴리우레탄"],
    traits: { warmth: 1, softness: 3, breathability: 2, durability: 3, pillingRisk: 2, careEase: 3, stretch: 5, weight: 5, naturalness: 1 },
    pros: ["신축성을 크게 높여요.", "움직임이 많은 옷에 유리해요."],
    cons: ["열에 약할 수 있어요."],
    careHints: ["고온 건조를 피하면 탄성 유지에 도움이 돼요."],
  },
};
