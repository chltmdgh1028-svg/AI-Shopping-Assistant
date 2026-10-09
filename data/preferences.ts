import type { MetricKey, PreferenceCategory, PreferenceId } from "@/types/shopping";

export type PreferenceDefinition = {
  id: PreferenceId;
  category: PreferenceCategory;
  label: string;
  plainLanguage: string;
  /** The one metric this preference is judged by. Never shared with another preference. */
  metric: MetricKey;
};

export const preferenceDefinitions: PreferenceDefinition[] = [
  { id: "soft_touch", category: "comfort", label: "부드러운 촉감", plainLanguage: "까슬거리거나 피부에 거슬리는 소재는 싫어요.", metric: "softness" },
  { id: "lightweight", category: "comfort", label: "가벼운 옷", plainLanguage: "오래 입어도 무겁지 않은 옷이 좋아요.", metric: "lightweight" },

  { id: "warmth", category: "function", label: "보온성", plainLanguage: "추운 날 따뜻하게 입을 수 있어야 해요.", metric: "warmth" },
  { id: "breathability", category: "function", label: "통기성", plainLanguage: "답답하지 않고 공기가 잘 통해야 해요.", metric: "breathability" },
  { id: "moisture_wicking", category: "function", label: "땀 배출·속건", plainLanguage: "땀이 차도 빠르게 마르는 옷이 좋아요.", metric: "moistureWicking" },
  { id: "stretch", category: "function", label: "신축성", plainLanguage: "움직일 때 편안해야 해요.", metric: "stretch" },

  { id: "easy_wash", category: "care", label: "세탁이 편함", plainLanguage: "집에서 관리하기 쉬운 옷이 좋아요.", metric: "washEase" },
  { id: "dryer_friendly", category: "care", label: "건조기 사용 가능", plainLanguage: "건조기를 사용할 수 있으면 좋아요.", metric: "dryerSafe" },
  { id: "low_pilling", category: "care", label: "보풀 적음", plainLanguage: "오래 입어도 표면이 깔끔했으면 해요.", metric: "pillingResistance" },
  { id: "low_wrinkle", category: "care", label: "구김 적음", plainLanguage: "쉽게 구겨지지 않았으면 해요.", metric: "wrinkleResistance" },

  { id: "long_lasting", category: "buying", label: "오래 입기", plainLanguage: "쉽게 늘어나거나 망가지지 않는 옷이 좋아요.", metric: "durability" },
  { id: "natural_materials", category: "buying", label: "천연 소재 선호", plainLanguage: "울, 면, 리넨 등 천연 섬유를 선호해요.", metric: "naturalFiberRatio" },
  { id: "value", category: "buying", label: "가성비", plainLanguage: "가격 대비 소재와 기능이 괜찮은 옷을 원해요.", metric: "valueForMoney" },
];

export const preferenceCategoryLabels: Record<PreferenceCategory, string> = {
  comfort: "착용감",
  function: "기능",
  care: "관리",
  buying: "구매 성향",
};

export const preferenceIds = new Set<string>(preferenceDefinitions.map((item) => item.id));
