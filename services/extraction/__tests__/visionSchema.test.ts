import { describe, expect, it } from "vitest";
import { buildVisionPrompt, mapVisionResult, visionResultSchema, visionSystemInstruction, type VisionResult } from "@/services/extraction/visionSchema";

const empty: VisionResult = { readability: "clear", materials: [], sizes: [], careInstructions: [] };
const size = (overrides: Partial<VisionResult["sizes"][number]> = {}): VisionResult["sizes"][number] => ({
  name: "M",
  shoulder: null,
  chest: null,
  waist: null,
  hip: null,
  length: null,
  sleeve: null,
  unit: "cm",
  chestIsFlatWidth: null,
  ...overrides,
});

describe("what the vision model is asked", () => {
  it("is told to copy only what is printed and to ignore instructions inside images", () => {
    expect(visionSystemInstruction).toContain("Never guess");
    expect(visionSystemInstruction).toContain("untrusted");
    expect(visionSystemInstruction).toContain("model wears");
  });

  it("names what to look for and how many images it gets", () => {
    const prompt = buildVisionPrompt({ url: "https://zigzag.kr/p/1", imageCount: 5, want: ["materials", "care"] });
    expect(prompt).toContain("5 images");
    expect(prompt).toContain("fabric composition");
    expect(prompt).toContain("care instructions");
    expect(prompt).not.toContain("size table");
  });

  it("rejects an answer that does not have the expected shape", () => {
    expect(visionResultSchema.safeParse({ readability: "clear", materials: "cotton 100%" }).success).toBe(false);
    expect(visionResultSchema.safeParse(empty).success).toBe(true);
  });
});

describe("reading the model's answer", () => {
  it("marks every value as image-vision and never rates it above medium", () => {
    const reading = mapVisionResult({
      ...empty,
      materials: [
        { name: "Cotton", percentage: 60 },
        { name: "Polyester", percentage: 40 },
      ],
      sizes: [size({ chest: 100, length: 65 })],
      careInstructions: ["단독 손세탁"],
    });
    expect(reading.confidence).toBe("medium");
    expect(reading.materials.every((item) => item.source === "image-vision" && item.confidence === "medium")).toBe(true);
    expect(reading.sizes[0]).toMatchObject({ name: "M", chest: 100, length: 65, unit: "cm", source: "image-vision", confidence: "medium" });
    expect(reading.careInstructions).toEqual(["단독 손세탁"]);
  });

  it("lowers confidence when the model says part of it was hard to read", () => {
    const reading = mapVisionResult({ ...empty, readability: "partial", materials: [{ name: "Wool", percentage: 100 }] });
    expect(reading.confidence).toBe("low");
    expect(reading.materials[0].confidence).toBe("low");
  });

  it("returns nothing when the images held nothing", () => {
    expect(mapVisionResult({ ...empty, readability: "none", materials: [{ name: "Wool", percentage: 100 }] })).toMatchObject({ materials: [], sizes: [], careInstructions: [] });
  });

  it("drops a blend that does not add up, with a reason", () => {
    const reading = mapVisionResult({ ...empty, materials: [{ name: "Cotton", percentage: 30 }, { name: "Nylon", percentage: 20 }] });
    expect(reading.materials).toEqual([]);
    expect(reading.warnings.join(" ")).toContain("50%");
  });

  it("ignores duplicate or unreadable fiber names", () => {
    const reading = mapVisionResult({
      ...empty,
      materials: [
        { name: "Cotton", percentage: 100 },
        { name: "cotton", percentage: 100 },
        { name: "Poly3ster", percentage: 50 },
        { name: "", percentage: 50 },
      ],
    });
    expect(reading.materials.map((item) => item.name)).toEqual(["Cotton"]);
  });

  it("converts inches to centimetres", () => {
    const reading = mapVisionResult({ ...empty, sizes: [size({ chest: 40, length: 26, unit: "inch" })] });
    expect(reading.sizes[0]).toMatchObject({ chest: 101.6, length: 66 });
    expect(reading.warnings.join(" ")).toContain("인치");
  });

  it("doubles a laid-flat chest, whether the table says so or the number is too small to be a circumference", () => {
    const labelled = mapVisionResult({ ...empty, sizes: [size({ chest: 52, waist: 40, chestIsFlatWidth: true })] });
    expect(labelled.sizes[0]).toMatchObject({ chest: 104, waist: 80 });

    const unlabelled = mapVisionResult({ ...empty, sizes: [size({ chest: 52 })] });
    expect(unlabelled.sizes[0].chest).toBe(104);
    expect(unlabelled.warnings.join(" ")).toContain("단면");

    const circumference = mapVisionResult({ ...empty, sizes: [size({ chest: 52, chestIsFlatWidth: false })] });
    expect(circumference.sizes[0].chest).toBe(52);
  });

  it("rejects measurements that cannot belong to a garment", () => {
    const reading = mapVisionResult({ ...empty, sizes: [size({ shoulder: 400, chest: 100 }), size({ name: "L", chest: 106 })] });
    expect(reading.sizes.map((row) => row.name)).toEqual(["L"]);
    expect(reading.warnings.join(" ")).toContain("M 사이즈");
  });

  it("keeps one row per size name and skips rows with no numbers", () => {
    const reading = mapVisionResult({ ...empty, sizes: [size({ chest: 100 }), size({ chest: 101 }), size({ name: "L" })] });
    expect(reading.sizes).toHaveLength(1);
    expect(reading.sizes[0].chest).toBe(100);
  });

  it("keeps only lines that read like care instructions", () => {
    const reading = mapVisionResult({ ...empty, careInstructions: ["단독 손세탁", "그늘에서 건조", "소재별 세탁 가이드 바로가기", "무료배송 이벤트", "Do not bleach"] });
    expect(reading.careInstructions).toEqual(["단독 손세탁", "그늘에서 건조", "Do not bleach"]);
  });
});
