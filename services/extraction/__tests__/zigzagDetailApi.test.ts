import { describe, expect, it, vi } from "vitest";
import { fetchZigzagSizes, parseSizeTable, sizeInfoRequest, SIZE_INFO_QUERY } from "@/services/extraction/adapters/zigzagDetailApi";

// Real tables returned by the size tab's API (October 2026).
const oneSize = [
  ["사이즈", "총기장", "어깨단면", "가슴단면", "암홀단면", "소매길이"],
  ["One Size", "49", "34", "43.5", "20", "56"],
];
const trousers = [
  ["사이즈", "총기장"],
  ["M", "45"],
];
const polo = [
  ["사이즈", "총기장", "어깨단면", "가슴단면", "소매길이", "밑단단면"],
  ["XL", "75", "45.5", "53", "63", "50"],
  ["2XL", "77", "48", "57", "64", "52"],
];
// A seller who typed a circumference (126) under the "단면" (laid-flat width) header.
const mislabelled = [
  ["사이즈", "총기장", "어깨단면", "가슴단면", "소매길이"],
  ["F/F", "64", "69", "126", "53"],
];

describe("size table from the size tab's API", () => {
  it("reads a one-size top and turns the laid-flat chest into a circumference", () => {
    const { sizes, warnings } = parseSizeTable(oneSize, "(단위 : cm)");
    expect(sizes).toEqual([{ name: "FREE", length: 49, shoulder: 34, chest: 87, sleeve: 56, unit: "cm", source: "structured-data", confidence: "high" }]);
    expect(warnings.join(" ")).toContain("단면");
  });

  it("does not map sleeve length to garment length", () => {
    const [size] = parseSizeTable(polo).sizes;
    expect(size).toMatchObject({ name: "XL", length: 75, sleeve: 63 });
  });

  it("reads several sizes", () => {
    expect(parseSizeTable(polo).sizes.map((row) => [row.name, row.chest])).toEqual([
      ["XL", 106],
      ["2XL", 114],
    ]);
  });

  it("accepts a table that only has a length (trousers) without inventing the rest", () => {
    const [size] = parseSizeTable(trousers).sizes;
    expect(size).toMatchObject({ name: "M", length: 45 });
    expect(size.chest).toBeUndefined();
    expect(size.shoulder).toBeUndefined();
  });

  it("uses a too-large 'flat' width as written instead of doubling it into an impossible chest", () => {
    const { sizes, warnings } = parseSizeTable(mislabelled);
    expect(sizes[0].chest).toBe(126);
    expect(warnings.join(" ")).toContain("그대로");
  });

  it("names a one-size row consistently", () => {
    for (const label of ["One Size", "ONE SIZE", "원사이즈/FREE", "F/F", "프리", "FREE"]) {
      expect(parseSizeTable([["사이즈", "총기장"], [label, "60"]]).sizes[0].name, label).toBe("FREE");
    }
  });

  it("skips cells that are not a plain number", () => {
    const { sizes } = parseSizeTable([["사이즈", "총기장", "가슴단면"], ["M", "-", "50"], ["L", "60~62", "52"]]);
    expect(sizes[0]).toMatchObject({ name: "M", chest: 100 });
    expect(sizes[0].length).toBeUndefined();
    expect(sizes[1].length).toBeUndefined();
  });

  it("converts inches when the note says so", () => {
    expect(parseSizeTable([["사이즈", "가슴"], ["M", "40"]], "(단위 : inch)").sizes[0].chest).toBe(101.6);
  });

  it("returns nothing for anything that is not a table", () => {
    expect(parseSizeTable(undefined).sizes).toEqual([]);
    expect(parseSizeTable([["사이즈", "가슴"]]).sizes).toEqual([]);
    expect(parseSizeTable([["색상", "블랙"], ["x", "y"]]).sizes).toEqual([]);
    expect(parseSizeTable("not a table").sizes).toEqual([]);
  });
});

describe("the API request", () => {
  it("only ever calls Zigzag's API host, whatever the page's runtime config says", () => {
    expect(sizeInfoRequest("https://api.zigzag.kr/api/2", "1").url).toBe("https://api.zigzag.kr/api/2/graphql/GetSizeInfo");
    for (const hostile of ["https://evil.example.com/api/2", "http://api.zigzag.kr/api/2", "https://api.zigzag.kr.evil.com/x", "not a url", undefined]) {
      expect(sizeInfoRequest(hostile, "1").url, String(hostile)).toBe("https://api.zigzag.kr/api/2/graphql/GetSizeInfo");
    }
  });

  it("sends the product id as a variable, not spliced into the query", () => {
    const request = sizeInfoRequest(undefined, "172008665");
    expect(request.body).toEqual({ query: SIZE_INFO_QUERY, variables: { catalog_product_id: "172008665" } });
    expect(SIZE_INFO_QUERY).not.toContain("172008665");
  });
});

describe("fetching the size table", () => {
  const answer = (valueList: unknown, description: string[] = ["(단위 : cm)"]) => ({ data: { pdp_size_info: { item_list: [{ value_list: valueList, description }], has_size_tab_content: true } } });

  it("returns the sizes from the API's answer", async () => {
    const post = vi.fn(async () => ({ ok: true as const, data: answer(oneSize) }));
    const found = await fetchZigzagSizes("172008665", undefined, post);
    expect(found?.sizes[0]).toMatchObject({ name: "FREE", chest: 87 });
    expect(post).toHaveBeenCalledWith("https://api.zigzag.kr/api/2/graphql/GetSizeInfo", expect.objectContaining({ variables: { catalog_product_id: "172008665" } }));
  });

  it("finds nothing when the tab has no table, the API fails, or the answer is not the expected shape", async () => {
    expect(await fetchZigzagSizes("1", undefined, async () => ({ ok: true, data: { data: { pdp_size_info: { item_list: [], has_size_tab_content: false } } } }))).toBeUndefined();
    expect(await fetchZigzagSizes("1", undefined, async () => ({ ok: false }))).toBeUndefined();
    expect(await fetchZigzagSizes("1", undefined, async () => ({ ok: true, data: { errors: [{ message: "x" }] } }))).toBeUndefined();
    expect(await fetchZigzagSizes("1", undefined, async () => ({ ok: true, data: null }))).toBeUndefined();
  });

  it("does not call the API for an id that is not numeric", async () => {
    const post = vi.fn(async () => ({ ok: true as const, data: answer(oneSize) }));
    expect(await fetchZigzagSizes("1; DROP", undefined, post)).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });
});
