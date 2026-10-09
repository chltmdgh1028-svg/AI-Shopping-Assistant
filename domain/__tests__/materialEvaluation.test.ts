import { describe, expect, it } from "vitest";
import { evaluateMaterials } from "@/domain/materialEvaluation";

describe("evaluateMaterials", () => {
  it("weights material traits by blend percentage", () => {
    const result = evaluateMaterials([
      { name: "Wool", percentage: 60 },
      { name: "Nylon", percentage: 25 },
      { name: "Acrylic", percentage: 15 },
    ]);

    expect(result.blendSummary).toContain("Wool 60%");
    expect(result.traits.warmth).toBeGreaterThanOrEqual(4);
    expect(result.traits.durability).toBeGreaterThanOrEqual(3);
    expect(result.materialNotes).toHaveLength(3);
  });

  it("does not invent missing material facts", () => {
    const result = evaluateMaterials([]);

    expect(result.materialNotes).toHaveLength(0);
    expect(result.assumptions[0]).toContain("확인하지 못했습니다");
  });
});
