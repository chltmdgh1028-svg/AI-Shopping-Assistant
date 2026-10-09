import { beforeEach, describe, expect, it } from "vitest";
import { migratePreferences, STORAGE_SCHEMA_VERSION } from "@/domain/preferenceMigration";
import { localShoppingRepository } from "@/repository/localShoppingRepository";

describe("migratePreferences", () => {
  it("turns 까슬거림 싫음 into 부드러운 촉감", () => {
    expect(migratePreferences([{ id: "avoid_itchy", weight: 3 }])).toEqual([{ id: "soft_touch", weight: 3 }]);
  });

  it("merges both old choices into one entry and never doubles the weight", () => {
    const merged = migratePreferences([
      { id: "soft_touch", weight: 2 },
      { id: "avoid_itchy", weight: 2 },
    ]);
    expect(merged).toEqual([{ id: "soft_touch", weight: 2 }]);

    // The larger of the two, not the sum.
    expect(migratePreferences([{ id: "avoid_itchy", weight: 3 }, { id: "soft_touch", weight: 1 }])).toEqual([{ id: "soft_touch", weight: 3 }]);
  });

  it("drops 품질 우선 without turning it into something that merely sounds similar", () => {
    const result = migratePreferences([{ id: "quality_first", weight: 3 }, { id: "warmth", weight: 2 }]);
    expect(result).toEqual([{ id: "warmth", weight: 2 }]);
    expect(result.some((item) => item.id === "long_lasting" || item.id === "value")).toBe(false);
  });

  it("keeps every other saved choice and its weight", () => {
    const saved = [
      { id: "warmth", weight: 2 },
      { id: "low_pilling", weight: 3 },
      { id: "easy_wash", weight: 1 },
      { id: "value", weight: 2 },
    ];
    expect(migratePreferences(saved)).toEqual(saved);
  });

  it("is idempotent", () => {
    const once = migratePreferences([{ id: "avoid_itchy", weight: 2 }, { id: "soft_touch", weight: 2 }, { id: "quality_first", weight: 2 }]);
    expect(migratePreferences(once)).toEqual(once);
  });

  it("deduplicates repeated ids and survives malformed entries", () => {
    expect(migratePreferences([{ id: "warmth", weight: 1 }, { id: "warmth", weight: 3 }])).toEqual([{ id: "warmth", weight: 3 }]);
    expect(migratePreferences([null, 5, "x", { id: 7 }, { weight: 2 }, { id: "not_a_preference", weight: 2 }, { id: "warmth", weight: 99 }])).toEqual([
      { id: "warmth", weight: 2 },
    ]);
    expect(migratePreferences("garbage")).toEqual([]);
    expect(migratePreferences(undefined)).toEqual([]);
  });
});

describe("localStorage migration keeps profile and history intact", () => {
  const profile = { gender: "female", heightCm: 163, weightKg: 52, preferredFit: "regular", chestCm: 84 };
  const history = [{ id: "keep-me", analyzedAt: "2026-01-01T00:00:00Z", product: { productName: "옛 분석" }, preferenceMatches: [{ preferenceId: "avoid_itchy", label: "까슬거림 싫음", rating: "good", score: 80, reason: "…" }] }];

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("migrates saved preferences once, writes the schema version, and leaves everything else alone", () => {
    window.localStorage.setItem("shopping-assistant:profile", JSON.stringify(profile));
    window.localStorage.setItem("shopping-assistant:history", JSON.stringify(history));
    window.localStorage.setItem(
      "shopping-assistant:preferences",
      JSON.stringify([{ id: "soft_touch", weight: 2 }, { id: "avoid_itchy", weight: 2 }, { id: "quality_first", weight: 3 }, { id: "warmth", weight: 2 }]),
    );

    const migrated = localShoppingRepository.getPreferences();
    expect(migrated).toEqual([
      { id: "soft_touch", weight: 2 },
      { id: "warmth", weight: 2 },
    ]);

    // The result is persisted and versioned, so the second read does no work.
    expect(JSON.parse(window.localStorage.getItem("shopping-assistant:preferences")!)).toEqual(migrated);
    expect(window.localStorage.getItem("shopping-assistant:schema")).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(localShoppingRepository.getPreferences()).toEqual(migrated);

    // Profile and history are exactly what was stored, including an old result that names a retired preference.
    expect(JSON.parse(window.localStorage.getItem("shopping-assistant:profile")!)).toEqual(profile);
    expect(JSON.parse(window.localStorage.getItem("shopping-assistant:history")!)).toEqual(history);
    expect(localShoppingRepository.getHistory()).toEqual(history);
  });

  it("does not invent preferences for someone who never chose any", () => {
    expect(localShoppingRepository.getPreferences().map((item) => item.id)).toEqual(["warmth", "soft_touch", "low_pilling", "easy_wash"]);
  });

  it("respects an emptied list (a user who deselected everything)", () => {
    window.localStorage.setItem("shopping-assistant:preferences", JSON.stringify([{ id: "quality_first", weight: 2 }]));
    expect(localShoppingRepository.getPreferences()).toEqual([]);
  });

  it("stamps the version when new choices are saved", () => {
    localShoppingRepository.savePreferences([{ id: "value", weight: 2 }]);
    expect(window.localStorage.getItem("shopping-assistant:schema")).toBe(String(STORAGE_SCHEMA_VERSION));
    expect(localShoppingRepository.getPreferences()).toEqual([{ id: "value", weight: 2 }]);
  });

  it("recovers from corrupted preference data", () => {
    window.localStorage.setItem("shopping-assistant:preferences", "{not json");
    expect(localShoppingRepository.getPreferences().length).toBeGreaterThan(0);
  });
});
