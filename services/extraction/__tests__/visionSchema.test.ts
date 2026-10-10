import { describe, expect, it } from "vitest";
import { buildVisionPrompt, mapVisionResult, parseLabel, visionResultSchema, visionSystemInstruction, type VisionResult } from "@/services/extraction/visionSchema";

const found = { materials: [], sizes: [], care: [] };
const empty: VisionResult = { readability: "clear", materials: [], sizes: [], careInstructions: [], foundIn: found };
const size = (overrides: Partial<VisionResult["sizes"][number]> = {}): VisionResult["sizes"][number] => ({
  name: "M",
  shoulder: null,
  chest: null,
  waist: null,
  hip: null,
  length: null,
  sleeve: null,
  thigh: null,
  rise: null,
  hem: null,
  armhole: null,
  unit: "cm",
  flatWidth: null,
  ...overrides,
});

describe("what the vision model is asked", () => {
  it("is told to copy only what is printed, to ignore instructions inside images, and to name the images it read", () => {
    expect(visionSystemInstruction).toContain("Never guess");
    expect(visionSystemInstruction).toContain("untrusted");
    expect(visionSystemInstruction).toContain("model wears");
    expect(visionSystemInstruction).toContain("foundIn");
  });

  it("scopes the request to the fields that are missing", () => {
    const materialsOnly = buildVisionPrompt({ url: "https://zigzag.kr/p/1", imageCount: 3, want: ["materials"] });
    expect(materialsOnly).toContain("3 images");
    expect(materialsOnly).toContain("fabric composition");
    expect(materialsOnly).not.toContain("size table");
    expect(materialsOnly).toContain("Leave these fields empty: sizes, care");

    const sizesOnly = buildVisionPrompt({ url: "https://zigzag.kr/p/1", imageCount: 2, want: ["sizes"] });
    expect(sizesOnly).toContain("size table");
    expect(sizesOnly).not.toContain("fabric composition");

    const both = buildVisionPrompt({ url: "https://zigzag.kr/p/1", imageCount: 2, want: ["materials", "sizes", "care"] });
    expect(both).not.toContain("Leave these fields empty");
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
      sizes: [size({ chest: 100, length: 65, flatWidth: false })],
      careInstructions: ["단독 손세탁"],
    });
    expect(reading.confidence).toBe("medium");
    expect(reading.materials.every((item) => item.source === "image-vision" && item.confidence === "medium")).toBe(true);
    expect(reading.sizes[0]).toMatchObject({ name: "M", chest: 100, length: 65, unit: "cm", source: "image-vision", confidence: "medium" });
    expect(reading.careInstructions).toEqual(["단독 손세탁"]);
  });

  it("only returns the fields that were asked for", () => {
    const answer = { ...empty, materials: [{ name: "Cotton", percentage: 100 }], sizes: [size({ chest: 100, flatWidth: false })], careInstructions: ["단독 손세탁"] };
    expect(mapVisionResult(answer, ["materials"])).toMatchObject({ sizes: [], careInstructions: [] });
    expect(mapVisionResult(answer, ["materials"]).materials).toHaveLength(1);
    expect(mapVisionResult(answer, ["sizes"]).materials).toEqual([]);
    expect(mapVisionResult(answer, ["sizes"]).sizes).toHaveLength(1);
    expect(mapVisionResult(answer, ["care"])).toMatchObject({ materials: [], sizes: [] });
  });

  it("does not warn about data it was not asked for", () => {
    const answer = { ...empty, sizes: [size({ chest: 52 })] };
    expect(mapVisionResult(answer, ["materials"]).warnings).toEqual([]);
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

  it("writes fibers the way the app does everywhere else", () => {
    const reading = mapVisionResult({ ...empty, materials: [{ name: "cotton", percentage: 95 }, { name: "SPANDEX", percentage: 5 }] });
    expect(reading.materials.map((item) => item.name)).toEqual(["Cotton", "Spandex"]);
    const unknown = mapVisionResult({ ...empty, materials: [{ name: "qiviut", percentage: 100 }] });
    expect(unknown.materials[0].name).toBe("Qiviut");
  });

  it("converts inches to centimetres", () => {
    const reading = mapVisionResult({ ...empty, sizes: [size({ chest: 40, length: 26, unit: "inch", flatWidth: false })] });
    expect(reading.sizes[0]).toMatchObject({ chest: 101.6, length: 66 });
    expect(reading.warnings.join(" ")).toContain("인치");
  });

  it("rejects measurements that cannot belong to a garment", () => {
    const reading = mapVisionResult({ ...empty, sizes: [size({ shoulder: 400, chest: 100, flatWidth: false }), size({ name: "L", chest: 106, flatWidth: false })] });
    expect(reading.sizes.map((row) => row.name)).toEqual(["L"]);
    expect(reading.warnings.join(" ")).toContain("M 사이즈");
  });

  it("keeps one row per size name and skips rows with no numbers", () => {
    const reading = mapVisionResult({ ...empty, sizes: [size({ chest: 100, flatWidth: false }), size({ chest: 101, flatWidth: false }), size({ name: "L" })] });
    expect(reading.sizes).toHaveLength(1);
    expect(reading.sizes[0].chest).toBe(100);
  });

  it("keeps only lines that read like care instructions", () => {
    const reading = mapVisionResult({ ...empty, careInstructions: ["단독 손세탁", "그늘에서 건조", "소재별 세탁 가이드 바로가기", "무료배송 이벤트", "Do not bleach"] });
    expect(reading.careInstructions).toEqual(["단독 손세탁", "그늘에서 건조", "Do not bleach"]);
  });
});

describe("size tables by garment", () => {
  it("TOP: shoulder, chest, sleeve, length", () => {
    const [top] = mapVisionResult({ ...empty, sizes: [size({ shoulder: 45, chest: 104, sleeve: 60, length: 66, flatWidth: false })] }).sizes;
    expect(top).toMatchObject({ shoulder: 45, chest: 104, sleeve: 60, length: 66 });
  });

  it("BOTTOM: waist, hip, thigh, rise, hem, length, with the laid-flat widths doubled", () => {
    const [bottom] = mapVisionResult({ ...empty, sizes: [size({ name: "28", waist: 36, hip: 48, thigh: 30, rise: 29, hem: 20, length: 100, flatWidth: true })] }).sizes;
    expect(bottom).toMatchObject({ waist: 72, hip: 96, thigh: 60, rise: 29, hem: 40, length: 100, source: "image-vision" });
  });

  it("ONE-PIECE: shoulder, chest, waist, hip, sleeve, length", () => {
    const [dress] = mapVisionResult({ ...empty, sizes: [size({ name: "FREE", shoulder: 38, chest: 46, waist: 38, hip: 52, sleeve: 56, length: 110, flatWidth: true })] }).sizes;
    expect(dress).toMatchObject({ shoulder: 38, chest: 92, waist: 76, hip: 104, sleeve: 56, length: 110 });
  });

  it("SKIRT: waist, hip, length, hem", () => {
    const [skirt] = mapVisionResult({ ...empty, sizes: [size({ name: "S", waist: 32, hip: 44, length: 60, hem: 40, flatWidth: true })] }).sizes;
    expect(skirt).toMatchObject({ waist: 64, hip: 88, length: 60, hem: 80 });
  });

  it("does not double a width the table calls a circumference", () => {
    const [row] = mapVisionResult({ ...empty, sizes: [size({ chest: 52, flatWidth: false })] }).sizes;
    expect(row.chest).toBe(52);
  });

  it("does not double a width that is too large to be a laid-flat one, even when the table says 단면", () => {
    const reading = mapVisionResult({ ...empty, sizes: [size({ chest: 126, flatWidth: true })] });
    expect(reading.sizes[0].chest).toBe(126);
    expect(reading.sizes[0].confidence).toBe("low");
    expect(reading.warnings.join(" ")).toContain("그대로");
  });

  it("does not guess when a number could be either: unlabelled and in the overlap, it is kept as printed", () => {
    const reading = mapVisionResult({ ...empty, sizes: [size({ chest: 78 })] });
    expect(reading.sizes[0].chest).toBe(78);
    expect(reading.sizes[0].confidence).toBe("low");
  });

  it("doubles an unlabelled width only when it cannot be a circumference", () => {
    const reading = mapVisionResult({ ...empty, sizes: [size({ chest: 52 })] });
    expect(reading.sizes[0].chest).toBe(104);
    expect(reading.warnings.join(" ")).toContain("단면");
  });
});

describe("a product sold as a set", () => {
  it("keeps the sizes of one garment when the tables of two are mixed, and says so", () => {
    const reading = mapVisionResult({
      ...empty,
      sizes: [
        size({ name: "XS", chest: 41, length: 34, flatWidth: true }),
        size({ name: "S", chest: 43, length: 35, flatWidth: true }),
        size({ name: "M", waist: 36.7, hip: 47.5, length: 56, flatWidth: true }),
      ],
    });
    expect(reading.sizes.map((row) => row.name)).toEqual(["XS", "S"]);
    expect(reading.warnings.join(" ")).toContain("여러 옷의 사이즈표");
  });

  it("keeps the larger group when it is the lower garment", () => {
    const reading = mapVisionResult({
      ...empty,
      sizes: [size({ name: "S", waist: 32, hip: 44, flatWidth: true }), size({ name: "M", waist: 34, hip: 46, flatWidth: true }), size({ name: "L", chest: 50, flatWidth: true })],
    });
    expect(reading.sizes.map((row) => row.name)).toEqual(["S", "M"]);
  });

  it("leaves a normal single table alone", () => {
    const reading = mapVisionResult({ ...empty, sizes: [size({ name: "S", chest: 100, flatWidth: false }), size({ name: "M", chest: 104, flatWidth: false })] });
    expect(reading.sizes).toHaveLength(2);
    expect(reading.warnings).toEqual([]);
  });
});

describe("where a value was read", () => {
  it("parses image and tile labels", () => {
    expect(parseLabel("17")).toEqual({ imageIndex: 17, tileIndex: undefined });
    expect(parseLabel("17-2")).toEqual({ imageIndex: 17, tileIndex: 2 });
    expect(parseLabel("abc")).toBeUndefined();
    expect(parseLabel("1-2-3")).toBeUndefined();
  });

  it("records the image and tile for each field that was filled, and nothing for fields that were not", () => {
    const reading = mapVisionResult({
      ...empty,
      materials: [{ name: "Cotton", percentage: 100 }],
      sizes: [],
      foundIn: { materials: ["17-2", "bad"], sizes: ["31"], care: [] },
    });
    expect(reading.evidence).toEqual([{ field: "materials", imageIndex: 17, tileIndex: 2, confidence: "medium" }]);
  });
});
