import { preferenceIds } from "@/data/preferences";
import type { PreferenceId, UserPreference } from "@/types/shopping";

/**
 * Storage schema versions: 1 = original 15 preferences (no version key stored), 2 = canonical 13.
 * Only the preference list is migrated. Profile and history are never touched or reset.
 */
export const STORAGE_SCHEMA_VERSION = 2;

// A retired id whose meaning lives on in exactly one current preference.
const merged: Record<string, PreferenceId> = { avoid_itchy: "soft_touch" };
// Retired with no equivalent: dropped, never turned into something that merely sounds similar.
// quality_first: brand and workmanship cannot be judged from a product page.

type Weight = UserPreference["weight"];

function toWeight(value: unknown): Weight {
  return value === 1 || value === 2 || value === 3 ? value : 2;
}

/**
 * Maps saved preferences onto the current list. Two old choices that now mean one thing become one
 * entry, and keep the larger weight rather than the sum, so the migration cannot double a preference.
 */
export function migratePreferences(stored: unknown): UserPreference[] {
  if (!Array.isArray(stored)) return [];

  const byId = new Map<PreferenceId, Weight>();
  for (const item of stored) {
    if (!item || typeof item !== "object") continue;
    const rawId = (item as { id?: unknown }).id;
    if (typeof rawId !== "string") continue;

    const id = (merged[rawId] ?? rawId) as string;
    if (!preferenceIds.has(id)) continue;

    const weight = toWeight((item as { weight?: unknown }).weight);
    const existing = byId.get(id as PreferenceId);
    byId.set(id as PreferenceId, existing === undefined ? weight : (Math.max(existing, weight) as Weight));
  }

  return [...byId].map(([id, weight]) => ({ id, weight }));
}
