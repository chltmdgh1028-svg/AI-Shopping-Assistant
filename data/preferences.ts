import type { PreferenceCategory, PreferenceId } from "@/types/shopping";

export type PreferenceDefinition = {
  id: PreferenceId;
  category: PreferenceCategory;
  label: string;
  plainLanguage: string;
};

export const preferenceDefinitions: PreferenceDefinition[] = [
  { id: "soft_touch", category: "comfort", label: "부드러운 촉감", plainLanguage: "피부에 닿는 느낌이 편해야 해요." },
  { id: "avoid_itchy", category: "comfort", label: "까슬거림 싫음", plainLanguage: "예민한 피부에도 부담이 적어야 해요." },
  { id: "lightweight", category: "comfort", label: "가벼운 옷", plainLanguage: "오래 입어도 무겁지 않은 옷이 좋아요." },
  { id: "warmth", category: "function", label: "보온성", plainLanguage: "겨울에 따뜻하게 입기 좋아야 해요." },
  { id: "breathability", category: "function", label: "통기성", plainLanguage: "답답하지 않고 공기가 잘 통해야 해요." },
  { id: "moisture_wicking", category: "function", label: "땀 배출", plainLanguage: "땀이 차도 쾌적했으면 해요." },
  { id: "stretch", category: "function", label: "신축성", plainLanguage: "움직일 때 편해야 해요." },
  { id: "easy_wash", category: "care", label: "세탁 편함", plainLanguage: "관리 난도가 낮아야 해요." },
  { id: "dryer_friendly", category: "care", label: "건조기 가능", plainLanguage: "건조기 사용 가능하면 좋아요." },
  { id: "low_pilling", category: "care", label: "보풀 적음", plainLanguage: "입을수록 표면이 지저분해지는 걸 피하고 싶어요." },
  { id: "low_wrinkle", category: "care", label: "구김 적음", plainLanguage: "다림질을 자주 하지 않아도 되었으면 해요." },
  { id: "value", category: "buying", label: "가성비", plainLanguage: "가격 대비 만족도가 중요해요." },
  { id: "long_lasting", category: "buying", label: "오래 입기", plainLanguage: "쉽게 망가지지 않는 옷이 좋아요." },
  { id: "natural_materials", category: "buying", label: "천연 소재", plainLanguage: "천연 섬유 비중이 높으면 좋아요." },
  { id: "quality_first", category: "buying", label: "품질 우선", plainLanguage: "가격이 높아도 완성도가 중요해요." },
];

export const preferenceCategoryLabels: Record<PreferenceCategory, string> = {
  comfort: "착용감",
  function: "기능",
  care: "관리",
  buying: "구매 성향",
};
