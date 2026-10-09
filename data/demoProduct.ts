import type { ProductFacts } from "@/types/shopping";

export const demoProduct: ProductFacts = {
  productName: "울 블렌드 크루넥 니트",
  brand: "Atelier Daily",
  category: "knitwear",
  price: "59,000원",
  images: [
    "https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1200&q=80",
  ],
  description:
    "포근한 울 블렌드 원사로 짜낸 데일리 니트입니다. 단정한 크루넥과 여유 있는 실루엣으로 겨울 단품 또는 이너로 입기 좋습니다.",
  materials: [
    { name: "Wool", percentage: 60 },
    { name: "Nylon", percentage: 25 },
    { name: "Acrylic", percentage: 15 },
  ],
  sizes: [
    { name: "M", shoulder: 46, chest: 106, length: 65, sleeve: 59 },
    { name: "L", shoulder: 48, chest: 112, length: 67, sleeve: 60 },
    { name: "XL", shoulder: 50, chest: 118, length: 69, sleeve: 61 },
  ],
  fit: "relaxed",
  careInstructions: [
    "세탁: 찬물 단독 손세탁 또는 울코스 권장",
    "건조: 건조기 사용 금지, 평평하게 눕혀 건조",
    "주의: 고온 세탁 시 수축 가능",
  ],
  sourceUrl: "https://demo.shopping-assistant.local/wool-blend-knit",
  factsSource: "demo",
};
