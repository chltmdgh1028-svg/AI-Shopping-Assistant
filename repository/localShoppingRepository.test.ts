import { beforeEach, describe, expect, it } from "vitest";
import { demoProduct } from "@/data/demoProduct";
import { archiveShoppingCache, cacheOwnerKey, clearShoppingCache, localShoppingRepository as repository } from "@/repository/localShoppingRepository";
import type { AnalysisResult, UserPreference, UserProfile } from "@/types/shopping";

const record = (id: string): AnalysisResult =>
  ({
    id,
    analyzedAt: "2026-10-10T00:00:00.000Z",
    product: { ...demoProduct, productName: `상품 ${id}` },
    score: { total: 70, verdict: "조건부 추천", summary: "", components: { preferenceMatch: 70, materialMatch: 70, sizeConfidence: 70, careCompatibility: 70 }, reasons: [] },
  }) as unknown as AnalysisResult;

const profile: UserProfile = { gender: "female", heightCm: 165, weightKg: 55, preferredFit: "regular", chestCm: 90 };
const preferences: UserPreference[] = [{ id: "warmth", weight: 3 }];

beforeEach(() => window.localStorage.clear());

describe("deleting a history record", () => {
  it("removes only that record and persists immediately", () => {
    for (const id of ["a", "b", "c"]) repository.saveAnalysis(record(id));
    expect(repository.getHistory().map((item) => item.id)).toEqual(["c", "b", "a"]);

    const left = repository.deleteAnalysis("b");
    expect(left.map((item) => item.id)).toEqual(["c", "a"]);
    // A fresh read (as after a page reload) sees the same thing.
    expect(repository.getHistory().map((item) => item.id)).toEqual(["c", "a"]);
  });

  it("leaves the profile and the preferences alone", () => {
    repository.saveProfile(profile);
    repository.savePreferences(preferences);
    repository.saveAnalysis(record("a"));

    repository.deleteAnalysis("a");

    expect(repository.getHistory()).toEqual([]);
    expect(repository.getProfile()).toEqual(profile);
    expect(repository.getPreferences()).toEqual(preferences);
  });

  it("can delete the last record and ignores an unknown id", () => {
    repository.saveAnalysis(record("only"));
    expect(repository.deleteAnalysis("missing").map((item) => item.id)).toEqual(["only"]);
    expect(repository.deleteAnalysis("only")).toEqual([]);
    expect(repository.getHistory()).toEqual([]);
  });
});

describe("cloud cache boundaries", () => {
  it("can archive one user's cache and clear the global shopping cache before account switching", () => {
    repository.saveProfile(profile);
    repository.savePreferences(preferences);
    repository.saveAnalysis(record("kakao-record"));
    window.localStorage.setItem(cacheOwnerKey, JSON.stringify("kakao-user"));

    archiveShoppingCache("kakao-user");
    clearShoppingCache();

    expect(repository.getProfile()).toBeNull();
    expect(repository.getHistory()).toEqual([]);
    expect(window.localStorage.getItem(cacheOwnerKey)).toBeNull();

    const archived = JSON.parse(window.localStorage.getItem("shopping-assistant:archived-cache:kakao-user") ?? "{}") as {
      profile?: UserProfile;
      history?: AnalysisResult[];
    };
    expect(archived.profile).toEqual(profile);
    expect(archived.history?.map((item) => item.id)).toEqual(["kakao-record"]);
  });
});
