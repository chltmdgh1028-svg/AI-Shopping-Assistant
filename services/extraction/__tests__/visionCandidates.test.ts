import { describe, expect, it } from "vitest";
import { buildScanPrompt, candidateScanSchema, parseCandidates, scanSystemInstruction } from "@/services/extraction/visionCandidates";

const known = new Set(["1", "2", "17-1", "17-2", "31", "40-3"]);
const all = ["materials", "sizes", "care"] as const;

describe("candidate answer", () => {
  it("keeps labels that were on a sheet, in the model's order, for each kind", () => {
    const parsed = parseCandidates({ materialCandidates: ["17-2", "17-1"], sizeCandidates: ["31"], careCandidates: ["40-3"] }, known, [...all]);
    expect(parsed).toEqual({ materials: ["17-2", "17-1"], sizes: ["31"], care: ["40-3"] });
  });

  it("drops labels the model made up, and duplicates", () => {
    const parsed = parseCandidates({ materialCandidates: ["99", "17-2", "17-2", " 17-2 "], sizeCandidates: ["17-9"], careCandidates: [] }, known, [...all]);
    expect(parsed).toEqual({ materials: ["17-2"], sizes: [], care: [] });
  });

  it("keeps at most three per kind", () => {
    const parsed = parseCandidates({ materialCandidates: ["1", "2", "17-1", "17-2", "31"], sizeCandidates: [], careCandidates: [] }, known, [...all]);
    expect(parsed.materials).toEqual(["1", "2", "17-1"]);
  });

  it("ignores kinds that were not asked about", () => {
    const parsed = parseCandidates({ materialCandidates: ["17-2"], sizeCandidates: ["31"], careCandidates: ["40-3"] }, known, ["sizes"]);
    expect(parsed).toEqual({ materials: [], sizes: ["31"], care: [] });
  });

  it("only accepts the expected shape", () => {
    expect(candidateScanSchema.safeParse({ materialCandidates: ["1"] }).success).toBe(false);
    expect(candidateScanSchema.safeParse({ materialCandidates: [], sizeCandidates: [], careCandidates: [] }).success).toBe(true);
  });
});

describe("what the scan is asked", () => {
  it("lists each sheet's cells in reading order and says what to look for", () => {
    const prompt = buildScanPrompt({ sheetLabels: [["1", "2", "17-1"], ["17-2", "31"]], columns: 4, want: ["materials", "sizes"] });
    expect(prompt).toContain("2 contact sheet");
    expect(prompt).toContain("Sheet 1, 4 columns, cells in reading order: 1, 2, 17-1");
    expect(prompt).toContain("Sheet 2");
    expect(prompt).toContain("fabric composition");
    expect(prompt).toContain("size chart");
    expect(prompt).not.toContain("care and washing");
  });

  it("asks for a judgement by layout and treats the thumbnails as untrusted", () => {
    expect(scanSystemInstruction).toContain("layout");
    expect(scanSystemInstruction).toContain("untrusted");
    expect(scanSystemInstruction).toContain("Never invent a number");
  });
});
