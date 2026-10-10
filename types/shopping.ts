export type Gender = "female" | "male" | "non_binary" | "prefer_not_to_say";
export type FitPreference = "slim" | "regular" | "relaxed" | "oversized";
export type PreferenceCategory = "comfort" | "function" | "care" | "buying";
// Where a value came from. "page"/"structured-data"/"meta" were read from the product page; "gemini-extracted"
// was structured by Gemini from page text and checked against it; "inferred" is a general estimate.
// "image-vision" = read by a vision model from a detail-page image, not from text: always a reference value.
export type ExtractionSource = "structured-data" | "meta" | "page" | "gemini-extracted" | "image-vision" | "inferred" | "user-input" | "demo";
// Where a detail came from, in the order the stages run. "Next data" is the page's own serialized state (it already
// holds collapsed sections such as the product-notice list); "detail API" is the call the page makes for a tab that loads
// on click; "image vision" is a model reading the detail-page images.
export type DetailSource = "zigzag-next-data" | "zigzag-detail-api" | "product-detail-image-vision";
export type DetailField = "price" | "images" | "materials" | "sizes" | "care";

export type ExtractionConfidence = "high" | "medium" | "low";
// Each preference is scored by exactly one metric (see data/preferences.ts), so no two choices count the same thing.
// Retired ids (avoid_itchy, quality_first) only exist in old saved data; see domain/preferenceMigration.ts.
export type PreferenceId =
  | "soft_touch"
  | "lightweight"
  | "warmth"
  | "breathability"
  | "moisture_wicking"
  | "stretch"
  | "easy_wash"
  | "dryer_friendly"
  | "low_pilling"
  | "low_wrinkle"
  | "long_lasting"
  | "natural_materials"
  | "value";

export type MetricKey =
  | "softness"
  | "lightweight"
  | "warmth"
  | "breathability"
  | "moistureWicking"
  | "stretch"
  | "washEase"
  | "dryerSafe"
  | "pillingResistance"
  | "wrinkleResistance"
  | "durability"
  | "naturalFiberRatio"
  | "valueForMoney";

// product_page: the manufacturer or the page said it. material_inference: estimated from fiber properties.
// price_and_material: needs both a price and a fiber blend.
export type MetricBasis = "product_page" | "material_inference" | "price_and_material";

// Where a judgement comes from, strongest first. When two sources disagree the earlier one wins
// (domain/sourcePriority.ts): a care label that says "dry in shade" beats "polyester dries fast".
export type EvidenceSource = "manufacturer-care" | "product-page" | "structured-data" | "ai-extraction" | "image-vision" | "material-knowledge" | "generic";

/**
 * The one evaluation of a metric. The preference list, the care section, the summary and the compatibility
 * score all read this object; none of them infers the metric again.
 */
export type MetricResult = {
  /** Absent only on results saved before the canonical evaluation. */
  key?: MetricKey;
  available: boolean;
  /** 0-100. Meaningless (0) when available is false: never average it in. */
  score: number;
  confidence: ExtractionConfidence;
  basis: MetricBasis;
  source?: EvidenceSource;
  /** Plain-language reason, written for this product ("상품 페이지에서 그늘 건조 지침 확인"). */
  reason?: string;
  note?: string;
};

export type MetricMap = Record<MetricKey, MetricResult>;

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
  source?: ExtractionSource;
  confidence?: ExtractionConfidence;
};

export type ProductSize = {
  name: string;
  shoulder?: number;
  chest?: number;
  waist?: number;
  hip?: number;
  length?: number;
  sleeve?: number;
  /** Trousers and skirts: thigh width, rise and hem; tops: the armhole. Circumferences and lengths in cm, like the rest. */
  thigh?: number;
  rise?: number;
  hem?: number;
  armhole?: number;
  unit?: "cm" | "inch";
  source?: ExtractionSource;
  confidence?: ExtractionConfidence;
};

export type ProductPricing = {
  /** What the buyer pays now: the sale price when there is one. This is the basis for value-for-money. */
  currentPrice: number;
  /** List price before the discount. Only set when it is higher than currentPrice. */
  originalPrice?: number;
  /** Whole percent, derived from the two prices (never copied from marketing text). */
  discountRate?: number;
  /** ISO 4217 code, e.g. KRW, USD. */
  currency: string;
  source: ExtractionSource;
  confidence: ExtractionConfidence;
  note?: string;
  /** Set only when the page body (not just a "[1+1]" in the title) states what the bundle contains. */
  promotionType?: "bundle";
  bundleQuantity?: number;
  /** currentPrice / bundleQuantity: a reference for one piece, not a price the shop lists. */
  unitPrice?: number;
  /** The "[1+1]" is in the name but no page text confirms the contents, so no unit price is computed. */
  bundleUnconfirmed?: boolean;
};

export type ProductFacts = {
  productName: string;
  brand?: string;
  category: "knitwear" | "shirt" | "top" | "pants" | "skirt" | "outerwear" | "dress" | "unknown";
  /** Display string kept for older saved results. New code reads pricing. */
  price?: string;
  currency?: string;
  pricing?: ProductPricing;
  images: string[];
  description: string;
  materials: MaterialBlend[];
  sizes: ProductSize[];
  fit?: FitPreference;
  careInstructions?: string[];
  sourceUrl?: string;
  factsSource: "product_page" | "manual_input" | "demo";
  extractionMetadata?: {
    strategy: Array<"json-ld" | "meta" | "semantic-html" | "page-text" | "hydration" | "ai-adapter" | "image-vision" | "manual" | "demo">;
    status: "complete" | "partial" | "failed" | "mock";
    confidence: ExtractionConfidence;
    aiProvider: "unavailable" | "mock" | "gemini";
    // used: Gemini structured the page. not_configured: no API key. failed: Gemini was tried and errored.
    aiStatus?: "used" | "not_configured" | "failed";
    aiModel?: string;
    /** Set when the pasted address was a share / short / deep link. Never holds tokens, keys or intermediate tracking URLs. */
    resolution?: {
      provider: "zigzag" | "generic";
      resolutionType: "short-link" | "deep-link";
      inputUrl: string;
      canonicalUrl: string;
      redirectCount: number;
      extractedProductId?: string;
      derivedFromId?: boolean;
    };
    /** Which stage supplied which fields, in the order they ran. Later stages only fill what earlier ones left empty. */
    detailSources?: Array<{ source: DetailSource; fields: DetailField[] }>;
    /** Detail-image reading (vision) fallback: what it was asked, what it filled, and what it cost. */
    vision?: {
      status: "used" | "no_result" | "skipped" | "failed";
      /** Only fields that text had left empty are ever filled from images. */
      fields: Array<"materials" | "sizes" | "care">;
      /** Images downloaded and decoded, and images left out (not fetched, too late, or unreadable). */
      imagesRead: number;
      imagesSkipped: number;
      /** Tiles cut from those images (a long image becomes several). */
      tiles?: number;
      /** direct: few tiles, all read. scan: the model picked from contact sheets. heuristic: the pick failed, so looks decided. */
      mode?: "direct" | "scan" | "heuristic";
      /** The labels ("17-2" = image 17, tile 2) the scan picked for each kind of information. */
      candidates?: { materials: string[]; sizes: string[]; care: string[] };
      /** Where each filled field was read: which image and tile, and how sure. */
      evidence?: Array<{ field: "materials" | "sizes" | "care"; imageIndex: number; tileIndex?: number; confidence: ExtractionConfidence }>;
      durationsMs?: { fetch: number; scan?: number; detail?: number; total: number };
      model?: string;
      reason?: string;
    };
    /** Where the time of one analysis went. */
    timingsMs?: { resolve: number; page: number; sizeApi?: number; textAi?: number; vision?: number; total: number };
    warnings: string[];
    fetchedAt?: string;
  };
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
  rating: "excellent" | "good" | "fair" | "poor" | "unavailable";
  score: number;
  reason: string;
  // The fields below are absent on results saved before the metric split; treat missing as available.
  available?: boolean;
  confidence?: ExtractionConfidence;
  basis?: MetricBasis;
  source?: EvidenceSource;
  metric?: MetricKey;
};

export type ValueEvaluation = {
  status: "available" | "unavailable";
  unavailableReason?: "no_price" | "no_materials" | "unknown_fibers" | "unsupported_currency" | "unknown_category";
  /**
   * product-relative: judged from this product's own price, bundle, blend, durability and care.
   * It is never a market comparison; marketComparison says so explicitly.
   */
  scope?: "product-relative";
  marketComparison?: "unavailable";
  /** What the judgement could not see ("시장 가격", "원단 등급" ...). */
  missing?: string[];
  /** The price per piece that was judged, when a bundle was confirmed. */
  unitPrice?: number;
  bundleQuantity?: number;
  /** 0-100, only when status is available. */
  score?: number;
  label: "가성비 좋음" | "가성비 보통" | "가성비 아쉬움" | "판단 어려움";
  summary: string;
  confidence: ExtractionConfidence;
  pricing?: ProductPricing;
  /** Rough price a garment with this fiber blend and category might be expected to cost. A reference, not a market quote. */
  expectedPrice?: number;
  caveat: string;
};

export type SizeRecommendation = {
  recommendedSize?: string;
  alternatives: string[];
  confidence: "high" | "medium" | "low" | "unavailable";
  reason: string;
  /** estimated = from height and weight only; measured = the user entered a chest measurement. */
  basis?: "measured" | "estimated";
  /** Only for low confidence: the sizes each fit would point to, instead of one confident pick. */
  fitCandidates?: { regular?: string; relaxed?: string };
};

export type CompatibilityScore = {
  total: number;
  verdict: "추천해요" | "조건부 추천" | "신중히 추천";
  summary: string;
  /** null = not enough information; the component is left out of the total instead of being guessed. */
  components: {
    preferenceMatch: number | null;
    materialMatch: number | null;
    sizeConfidence: number | null;
    careCompatibility: number | null;
  };
  reasons: string[];
};

export type CareKind = "washing" | "drying" | "bleach" | "wring" | "ironing" | "dry_clean" | "other";

/** A care instruction the product page itself states. Never generated by the app. */
export type ManufacturerCareItem = { kind: CareKind; text: string };

/** General advice the app derives from the fibers. Always shown apart from manufacturerCare. */
export type InferredCareTip = { kind: "washing" | "drying" | "storage" | "shape"; text: string };

export type CareGuide = {
  /** product_page when the page gave any care instruction; material_inference when the whole guide is estimated. */
  source: "product_page" | "material_inference";
  /** Display lines kept for results saved before the split; new UI reads manufacturer and inferred. */
  washing: string;
  drying: string;
  storage: string;
  cautions: string[];
  manufacturer?: ManufacturerCareItem[];
  inferred?: InferredCareTip[];
  /** One verdict per care question, read from the same metrics the preference list uses. */
  dryer?: "allowed" | "not_recommended" | "unknown";
  washing_effort?: "easy" | "moderate" | "demanding" | "unknown";
  /** The care lines were read from detail-page images by a model: reference only. */
  fromImage?: boolean;
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
  /** Absent on results saved before the metric split. */
  metrics?: MetricMap;
  value?: ValueEvaluation;
};
