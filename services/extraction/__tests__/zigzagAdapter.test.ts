import { describe, expect, it } from "vitest";
import { extractWithAdapter } from "@/services/extraction/adapters";
import { extractZigzagProduct } from "@/services/extraction/adapters/zigzagAdapter";
import { realisticDetailHtml, zigzagPage } from "./fixtures/zigzagPage";

describe("Zigzag product adapter", () => {
  const result = extractZigzagProduct(zigzagPage())!;
  const product = result.product;

  it("reads the product name, store and category from the page data", () => {
    expect(product.productName).toBe("[가을신상/기획특가!] 베니즈 브이넥 베이직 긴팔 니트 가디건");
    expect(product.brand).toBe("베러뮤즈");
    expect(product.category).toBe("knitwear");
  });

  it("reads the sale price, the list price and the discount from the page data", () => {
    expect(product.pricing).toMatchObject({ currentPrice: 29900, originalPrice: 39900, discountRate: 25, currency: "KRW", confidence: "high" });
    expect(product.price).toBe("29,900원");
  });

  it("mentions the coupon price but never uses it as the price", () => {
    expect(product.pricing?.currentPrice).toBe(29900);
    expect(product.pricing?.note).toContain("20,930원");
    expect(product.pricing?.note).toContain("쿠폰");
  });

  it("takes the product image from the page data, preferring the JPEG rendition", () => {
    expect(product.images?.[0]).toContain("format=jpeg");
    expect(product.images?.every((url) => url.startsWith("https://"))).toBe(true);
  });

  it("reads the blend from the seller's description, including PBT", () => {
    expect(product.materials?.map((item) => `${item.name} ${item.percentage}`)).toEqual(["Cotton 50", "Polyester 29", "PBT 21"]);
  });

  it("reads the printed measurements as one size and turns the laid-flat chest into a circumference", () => {
    expect(product.sizes).toEqual([
      { name: "FREE", shoulder: 34, chest: 87, armhole: 20, length: 49, sleeve: 56, unit: "cm", source: "structured-data", confidence: "medium" },
    ]);
    expect(result.warnings.join(" ")).toContain("43.5cm");
    expect(result.warnings.join(" ")).toContain("87cm");
  });

  it("does not turn a link to a care guide into a care instruction", () => {
    expect(product.careInstructions).toEqual([]);
  });

  it("keeps real care lines when the seller writes them", () => {
    const withCare = extractZigzagProduct(zigzagPage({ detailHtml: realisticDetailHtml.replace("</div>\n</div>", "</div>\n<div><span>세탁: 단독 손세탁</span></div><div><span>건조: 그늘에 건조</span></div></div>") }))!;
    expect(withCare.product.careInstructions).toEqual(["세탁: 단독 손세탁", "건조: 그늘에 건조"]);
  });

  it("does not double a chest that is already a circumference", () => {
    const html = realisticDetailHtml.replace("가슴43.5", "가슴104");
    const adult = extractZigzagProduct(zigzagPage({ detailHtml: html }))!;
    expect(adult.product.sizes?.[0].chest).toBe(104);
    expect(adult.warnings).toEqual([]);
  });

  it("hands the real page content to the model, ahead of the visible text", () => {
    expect(result.text).toContain("cotton 50% polyester 29% pbt 21%");
    expect(result.text).toContain("판매가: 29,900원 (정가 39,900원)");
    expect(result.text.indexOf("상품명:")).toBe(0);
  });

  it("invents nothing when a value is not in the data", () => {
    const bare = extractZigzagProduct(zigzagPage({ currentPrice: null, listPrice: null, couponPrice: null, detailHtml: "<div>상세 이미지를 확인하세요</div>" }))!;
    expect(bare.product.pricing).toBeUndefined();
    expect(bare.product.materials).toEqual([]);
    expect(bare.product.sizes).toEqual([]);
  });
});

describe("adapter selection", () => {
  it("only reads Zigzag hosts", () => {
    const html = zigzagPage();
    expect(extractWithAdapter(html, "https://zigzag.kr/p/172008665")?.adapter).toBe("zigzag");
    expect(extractWithAdapter(html, "https://store.zigzag.kr/catalog/products/1")?.adapter).toBe("zigzag");
    expect(extractWithAdapter(html, "https://shop.example.com/p/1")).toBeUndefined();
    expect(extractWithAdapter(html, "not a url")).toBeUndefined();
  });

  it("leaves a Zigzag page without product data to the generic path", () => {
    expect(extractWithAdapter(zigzagPage({ withNextData: false }), "https://zigzag.kr/p/1")).toBeUndefined();
    expect(extractZigzagProduct('<script id="__NEXT_DATA__">{broken</script>')).toBeUndefined();
    expect(extractZigzagProduct('<script id="__NEXT_DATA__">{"props":{"pageProps":{}}}</script>')).toBeUndefined();
  });
});
