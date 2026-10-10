import { migratePreferences, STORAGE_SCHEMA_VERSION } from "@/domain/preferenceMigration";
import type { AnalysisResult, UserPreference, UserProfile } from "@/types/shopping";

export const profileKey = "shopping-assistant:profile";
export const preferencesKey = "shopping-assistant:preferences";
export const historyKey = "shopping-assistant:history";
export const schemaKey = "shopping-assistant:schema";

export const defaultPreferences: UserPreference[] = [
  { id: "warmth", weight: 2 },
  { id: "soft_touch", weight: 2 },
  { id: "low_pilling", weight: 2 },
  { id: "easy_wash", weight: 1 },
];

export type ShoppingRepository = {
  getProfile(): UserProfile | null;
  saveProfile(profile: UserProfile): void;
  getPreferences(): UserPreference[];
  savePreferences(preferences: UserPreference[]): void;
  getHistory(): AnalysisResult[];
  setHistory(history: AnalysisResult[]): void;
  saveAnalysis(result: AnalysisResult): void;
  /** Removes one record and returns what is left. Profile and preferences are untouched. */
  deleteAnalysis(id: string): AnalysisResult[];
};

export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T) {
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
    const stored = readJson<unknown>(preferencesKey, null);
    if (stored === null) return defaultPreferences;

    const version = readJson<number>(schemaKey, 1);
    if (version >= STORAGE_SCHEMA_VERSION) return migratePreferences(stored);

    // First read after the preference list changed: migrate once and keep the result. Only preferences are
    // rewritten. Profile and history are left exactly as they were.
    const migrated = migratePreferences(stored);
    writeJson(preferencesKey, migrated);
    writeJson(schemaKey, STORAGE_SCHEMA_VERSION);
    return migrated;
  },
  savePreferences(preferences) {
    writeJson(preferencesKey, preferences);
    writeJson(schemaKey, STORAGE_SCHEMA_VERSION);
  },
  getHistory() {
    return readJson<AnalysisResult[]>(historyKey, []);
  },
  setHistory(history) {
    writeJson(historyKey, history);
  },
  saveAnalysis(result) {
    const next = [result, ...this.getHistory().filter((item) => item.id !== result.id)].slice(0, 12);
    writeJson(historyKey, next);
  },
  deleteAnalysis(id) {
    const next = this.getHistory().filter((item) => item.id !== id);
    writeJson(historyKey, next);
    return next;
  },
};
