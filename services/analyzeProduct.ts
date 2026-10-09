import { buildCareGuide } from "@/domain/careGuide";
import { evaluateMaterials } from "@/domain/materialEvaluation";
import { matchPreferences } from "@/domain/preferenceMatching";
import { calculateCompatibilityScore } from "@/domain/scoring";
import { recommendSize } from "@/domain/sizeRecommendation";
import { HybridProductParser } from "@/services/productParser";
import type { AnalysisResult, ProductInput, UserPreference, UserProfile } from "@/types/shopping";

const parser = new HybridProductParser();

export async function analyzeProduct(input: ProductInput, profile: UserProfile, preferences: UserPreference[]): Promise<AnalysisResult> {
  const product = await parser.parse(input);
  const material = evaluateMaterials(product.materials);
  const preferenceMatches = matchPreferences(preferences, material, product);
  const size = recommendSize(profile, product);
  const care = buildCareGuide(product, material);
  const score = calculateCompatibilityScore({
    preferences,
    preferenceMatches,
    material,
    product,
    size,
  });

  return {
    id: crypto.randomUUID(),
    analyzedAt: new Date().toISOString(),
    product,
    material,
    preferenceMatches,
    size,
    care,
    score,
  };
}
