import type { AnalysisResult, UserPreference, UserProfile } from "@/types/shopping";

const profileKey = "shopping-assistant:profile";
const preferencesKey = "shopping-assistant:preferences";
const historyKey = "shopping-assistant:history";

export type ShoppingRepository = {
  getProfile(): UserProfile | null;
  saveProfile(profile: UserProfile): void;
  getPreferences(): UserPreference[];
  savePreferences(preferences: UserPreference[]): void;
  getHistory(): AnalysisResult[];
  saveAnalysis(result: AnalysisResult): void;
};

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export const localShoppingRepository: ShoppingRepository = {
  getProfile() {
    return readJson<UserProfile | null>(profileKey, null);
  },
  saveProfile(profile) {
    writeJson(profileKey, profile);
  },
  getPreferences() {
    return readJson<UserPreference[]>(preferencesKey, [
      { id: "warmth", weight: 2 },
      { id: "soft_touch", weight: 2 },
      { id: "low_pilling", weight: 2 },
      { id: "easy_wash", weight: 1 },
    ]);
  },
  savePreferences(preferences) {
    writeJson(preferencesKey, preferences);
  },
  getHistory() {
    return readJson<AnalysisResult[]>(historyKey, []);
  },
  saveAnalysis(result) {
    const next = [result, ...this.getHistory().filter((item) => item.id !== result.id)].slice(0, 12);
    writeJson(historyKey, next);
  },
};
