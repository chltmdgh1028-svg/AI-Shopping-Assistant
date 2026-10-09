import type { ProductFacts } from "@/types/shopping";

export const demoProduct: ProductFacts = {
  productName: "울 블렌드 크루넥 니트",
  brand: "Atelier Daily",
  category: "knitwear",
  price: "₩59,000",
  currency: "KRW",
  // A made-up list price and sale price, so the sample can show how a discount is read.
  pricing: { currentPrice: 59000, originalPrice: 79000, discountRate: 25, currency: "KRW", source: "demo", confidence: "high" },
  // No photo on purpose: the sample is made-up data, and the brand hero photo is not this product.
  // The UI renders a neutral fabric swatch for products without an image.
  images: [],
  description:
    "포근한 울 블렌드 원사로 짜낸 데일리 니트입니다. 단정한 크루넥과 여유 있는 실루엣으로 겨울 단품 또는 이너로 입기 좋습니다.",
  materials: [
    { name: "Wool", percentage: 60, source: "demo", confidence: "high" },
    { name: "Nylon", percentage: 25, source: "demo", confidence: "high" },
    { name: "Acrylic", percentage: 15, source: "demo", confidence: "high" },
  ],
  sizes: [
    { name: "M", shoulder: 46, chest: 106, length: 65, sleeve: 59, unit: "cm", source: "demo", confidence: "high" },
    { name: "L", shoulder: 48, chest: 112, length: 67, sleeve: 60, unit: "cm", source: "demo", confidence: "high" },
    { name: "XL", shoulder: 50, chest: 118, length: 69, sleeve: 61, unit: "cm", source: "demo", confidence: "high" },
  ],
  fit: "relaxed",
  careInstructions: [
    "세탁: 찬물 단독 손세탁 또는 울코스 권장",
    "건조: 건조기 사용 금지, 평평하게 눕혀 건조",
    "주의: 고온 세탁 시 수축 가능",
  ],
  sourceUrl: "https://demo.shopping-assistant.local/wool-blend-knit",
  factsSource: "demo",
  extractionMetadata: {
    strategy: ["demo"],
    status: "mock",
    confidence: "high",
    aiProvider: "unavailable",
    warnings: [],
  },
};
