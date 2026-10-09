export type Gender = "female" | "male" | "non_binary" | "prefer_not_to_say";
export type FitPreference = "slim" | "regular" | "relaxed" | "oversized";
export type PreferenceCategory = "comfort" | "function" | "care" | "buying";
export type PreferenceId =
  | "soft_touch"
  | "avoid_itchy"
  | "lightweight"
  | "warmth"
  | "breathability"
  | "moisture_wicking"
  | "stretch"
  | "easy_wash"
  | "dryer_friendly"
  | "low_pilling"
  | "low_wrinkle"
  | "value"
  | "long_lasting"
  | "natural_materials"
  | "quality_first";

export type UserProfile = {
  gender: Gender;
  heightCm: number;
  weightKg: number;
  topSize?: string;
  bottomSize?: string;
  chestCm?: number;
  waistCm?: number;
  shoulderCm?: number;
  preferredFit: FitPreference;
};

export type UserPreference = {
  id: PreferenceId;
  weight: 1 | 2 | 3;
};

export type MaterialBlend = {
  name: string;
  percentage: number;
};

export type ProductSize = {
  name: string;
  shoulder?: number;
  chest?: number;
  waist?: number;
  length?: number;
  sleeve?: number;
};

export type ProductFacts = {
  productName: string;
  brand?: string;
  category: "knitwear" | "shirt" | "pants" | "outerwear" | "dress" | "unknown";
  price?: string;
  images: string[];
  description: string;
  materials: MaterialBlend[];
  sizes: ProductSize[];
  fit?: FitPreference;
  careInstructions?: string[];
  sourceUrl?: string;
  factsSource: "product_page" | "manual_input" | "demo";
};

export type ProductInput = {
  url?: string;
  manualText?: string;
};

export type MaterialTrait =
  | "warmth"
  | "softness"
  | "breathability"
  | "durability"
  | "pillingRisk"
  | "careEase"
  | "stretch"
  | "weight"
  | "naturalness";

export type TraitScore = 1 | 2 | 3 | 4 | 5;

export type MaterialEvaluation = {
  blendSummary: string;
  traits: Record<MaterialTrait, TraitScore>;
  materialNotes: Array<{
    name: string;
    percentage: number;
    pros: string[];
    cons: string[];
  }>;
  assumptions: string[];
};

export type PreferenceMatch = {
  preferenceId: PreferenceId;
  label: string;
  rating: "excellent" | "good" | "fair" | "poor";
  score: number;
  reason: string;
};

export type SizeRecommendation = {
  recommendedSize?: string;
  alternatives: string[];
  confidence: "high" | "medium" | "low" | "unavailable";
  reason: string;
};

export type CompatibilityScore = {
  total: number;
  verdict: "추천해요" | "조건부 추천" | "신중히 추천";
  summary: string;
  components: {
    preferenceMatch: number;
    materialMatch: number;
    sizeConfidence: number;
    careCompatibility: number;
  };
  reasons: string[];
};

export type CareGuide = {
  source: "product_page" | "material_inference";
  washing: string;
  drying: string;
  storage: string;
  cautions: string[];
};

export type AnalysisResult = {
  id: string;
  analyzedAt: string;
  product: ProductFacts;
  material: MaterialEvaluation;
  preferenceMatches: PreferenceMatch[];
  size: SizeRecommendation;
  care: CareGuide;
  score: CompatibilityScore;
};
