// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { evaluateProduct } from "@/domain/evaluation";
import { ExtractionProviderError, type ImageExtractionInput, type ImageExtractionResult, type ProductExtractionProvider } from "@/services/extraction/aiProvider";
import { extractZigzagProduct } from "@/services/extraction/adapters/zigzagAdapter";
import { VISION_LIMITS, loadDetailImages, pickDetailImages, runVisionFallback } from "@/services/extraction/visionFallback";
import { extractProductFromUrl } from "@/services/extraction/urlExtraction";
import type { ProductFacts } from "@/types/shopping";
import { zigzagPage } from "./fixtures/zigzagPage";

const passThrough = async (url: string) => ({ ok: true as const, inputUrl: url, canonicalUrl: url, provider: "none" as const, resolutionType: "none" as const, redirectCount: 0 });
const PAGE = "https://zigzag.kr/p/172008665";

const sizeTable = { data: { pdp_size_info: { item_list: [{ value_list: [["사이즈", "총기장", "가슴단면"], ["M", "60", "50"]], description: ["(단위 : cm)"] }] } } };
const okPost = vi.fn(async () => ({ ok: true as const, data: sizeTable }));
const image = { ok: true as const, bytes: Buffer.from("image-bytes"), mimeType: "image/jpeg", finalUrl: "x" };
const okImage = vi.fn(async () => image);

function visionProvider(result: Partial<ImageExtractionResult> = {}, fail?: ExtractionProviderError) {
  const extractFromImages = vi.fn(async (input: ImageExtractionInput) => {
    void input;
    if (fail) throw fail;
    return { materials: [], sizes: [], careInstructions: [], confidence: "medium" as const, warnings: [], model: "gemini-3.5-flash-lite", ...result };
  });
  const provider: ProductExtractionProvider = {
    providerName: "gemini",
    isAvailable: () => true,
    // The text model answers with nothing here: these tests are about what the stages add.
    extract: async () => ({ product: {}, confidence: "low", warnings: [] }),
    extractFromImages,
  };
  return { provider, extractFromImages };
}

const imageMaterials = [
  { name: "Cotton", percentage: 60, source: "image-vision" as const, confidence: "medium" as const },
  { name: "Polyester", percentage: 40, source: "image-vision" as const, confidence: "medium" as const },
];
const imageSizes = [{ name: "FREE", chest: 100, length: 60, unit: "cm" as const, source: "image-vision" as const, confidence: "medium" as const }];

const run = (html: string, provider?: ProductExtractionProvider, options = {}) =>
  extractProductFromUrl(PAGE, provider, async (url) => ({ ok: true as const, html, finalUrl: url }), passThrough, { postJson: okPost, fetchImage: okImage, ...options });

describe("stage 1: the collapsed product-notice list is already in the page data", () => {
  const essentials = [
    { name: "제조국", value: "대한민국" },
    { name: "제품소재", value: "레이온70%,폴리27%,스판3%" },
    { name: "세탁방법 및 취급시 주의사항", value: "단독손세탁, 그늘에서 건조" },
  ];

  it("reads the blend and the care from it, with no click and no model", async () => {
    const result = await run(zigzagPage({ detailHtml: "<div><img src=\"https://img.example.com/a.jpg\"></div>", essentials }));
    if (!result.ok) throw new Error("expected a product");
    expect(result.product.materials.map((item) => `${item.name} ${item.percentage}`)).toEqual(["Rayon 70", "Polyester 27", "Spandex 3"]);
    expect(result.product.careInstructions).toEqual(["단독손세탁", "그늘에서 건조"]);
    expect(result.product.extractionMetadata?.detailSources?.[0]).toMatchObject({ source: "zigzag-next-data" });
    expect(result.product.extractionMetadata?.detailSources?.[0].fields).toEqual(expect.arrayContaining(["materials", "care"]));
  });

  it("ignores entries that only say 'see the detail page'", () => {
    const adapter = extractZigzagProduct(
      zigzagPage({ detailHtml: "<div>이미지</div>", essentials: [{ name: "제품소재", value: "상세정보참고" }, { name: "제조국", value: "상품상세참조" }] }),
    )!;
    expect(adapter.product.materials).toEqual([]);
    expect(adapter.text).not.toContain("상세정보참고");
  });

  it("keeps the notice list in the text the model reads", () => {
    const adapter = extractZigzagProduct(zigzagPage({ essentials }))!;
    expect(adapter.text).toContain("상품정보 제공고시:");
    expect(adapter.text).toContain("제품소재: 레이온70%,폴리27%,스판3%");
  });
});

describe("stage 2: what loads on click comes from the site's own API", () => {
  it("asks the size API only when the page data has no size, and records the source", async () => {
    okPost.mockClear();
    const result = await run(zigzagPage({ detailHtml: "<div>이미지</div>", essentials: [{ name: "제품소재", value: "면100%" }, { name: "세탁방법", value: "단독손세탁" }] }));
    if (!result.ok) throw new Error("expected a product");
    expect(okPost).toHaveBeenCalledTimes(1);
    expect(result.product.sizes[0]).toMatchObject({ name: "M", chest: 100, length: 60, source: "structured-data" });
    expect(result.product.extractionMetadata?.detailSources?.map((stage) => stage.source)).toEqual(["zigzag-next-data", "zigzag-detail-api"]);
    expect(result.product.extractionMetadata?.detailSources?.[1].fields).toEqual(["sizes"]);
  });

  it("does not call the API when the page data already has a size", async () => {
    okPost.mockClear();
    await run(zigzagPage());
    expect(okPost).not.toHaveBeenCalled();
  });

  it("never replaces a size the page data already gave", async () => {
    const result = await run(zigzagPage());
    if (!result.ok) throw new Error("expected a product");
    expect(result.product.sizes[0]).toMatchObject({ name: "FREE", chest: 87 });
  });

  it("carries on when the API is down", async () => {
    const result = await run(zigzagPage({ detailHtml: "<div>이미지</div>" }), undefined, { postJson: async () => ({ ok: false as const }) });
    if (!result.ok) throw new Error("expected a product");
    expect(result.product.sizes).toEqual([]);
    expect(result.product.extractionMetadata?.detailSources?.map((stage) => stage.source)).toEqual(["zigzag-next-data"]);
  });
});

describe("stage 4: detail-page images, only for what text left empty", () => {
  const imageOnly = zigzagPage({ detailHtml: "<div>이미지</div>", images: ["https://img.example.com/1.jpg", "https://img.example.com/2.jpg"] });

  it("reads blend, size and care from the images when nothing else had them", async () => {
    okImage.mockClear();
    const { provider, extractFromImages } = visionProvider({ materials: imageMaterials, sizes: imageSizes, careInstructions: ["단독 손세탁"] });
    const result = await run(imageOnly, provider, { postJson: async () => ({ ok: false as const }) });
    if (!result.ok) throw new Error("expected a product");
    const { product } = result;

    expect(extractFromImages).toHaveBeenCalledTimes(1);
    expect(extractFromImages.mock.calls[0][0].want).toEqual(["materials", "sizes", "care"]);
    expect(okImage).toHaveBeenCalledTimes(2);

    expect(product.materials.every((item) => item.source === "image-vision")).toBe(true);
    expect(product.sizes[0].source).toBe("image-vision");
    expect(product.careInstructions).toEqual(["단독 손세탁"]);
    expect(product.extractionMetadata?.vision).toMatchObject({ status: "used", fields: ["materials", "sizes", "care"], imagesRead: 2, model: "gemini-3.5-flash-lite" });
    expect(product.extractionMetadata?.strategy).toContain("image-vision");
    expect(product.extractionMetadata?.detailSources?.at(-1)).toEqual({ source: "product-detail-image-vision", fields: ["materials", "sizes", "care"] });
    // It says plainly that a model read this.
    expect(product.extractionMetadata?.warnings.join(" ")).toContain("상세 이미지에서 AI가 읽은 값");
    // And the "could not find the blend" notice is gone, because one was found.
    expect(product.extractionMetadata?.warnings.join(" ")).not.toContain("소재 혼용률을 자동으로 확인하지 못했습니다");
  });

  it("only asks for, and only fills, what the text stages left empty", async () => {
    const text = zigzagPage({ detailHtml: "<div>이미지</div>", essentials: [{ name: "제품소재", value: "울100%" }], images: ["https://img.example.com/1.jpg"] });
    const { provider, extractFromImages } = visionProvider({ materials: imageMaterials, sizes: imageSizes, careInstructions: ["드라이클리닝"] });
    const result = await run(text, provider);
    if (!result.ok) throw new Error("expected a product");

    // Blend came from the notice list and size from the API, so only care is asked for.
    expect(extractFromImages.mock.calls[0][0].want).toEqual(["care"]);
    expect(result.product.materials.map((item) => item.name)).toEqual(["Wool"]);
    expect(result.product.sizes[0].source).toBe("structured-data");
    expect(result.product.careInstructions).toEqual(["드라이클리닝"]);
    expect(result.product.extractionMetadata?.vision?.fields).toEqual(["care"]);
  });

  it("is not called at all when blend, size and care are all known", async () => {
    const full = zigzagPage({
      detailHtml: "<div>이미지</div>",
      essentials: [{ name: "제품소재", value: "면100%" }, { name: "세탁방법", value: "단독손세탁" }],
      images: ["https://img.example.com/1.jpg"],
    });
    const { provider, extractFromImages } = visionProvider({ materials: imageMaterials });
    const result = await run(full, provider);
    if (!result.ok) throw new Error("expected a product");
    expect(extractFromImages).not.toHaveBeenCalled();
    expect(okImage).not.toHaveBeenCalledWith(expect.stringContaining("img.example.com/1.jpg"), expect.anything());
    expect(result.product.extractionMetadata?.vision).toBeUndefined();
  });

  it("treats image-read care as reference level in the evaluation", async () => {
    const { provider } = visionProvider({ materials: imageMaterials, sizes: imageSizes, careInstructions: ["단독 손세탁", "그늘에 건조"] });
    const result = await run(imageOnly, provider, { postJson: async () => ({ ok: false as const }) });
    if (!result.ok) throw new Error("expected a product");
    const { metrics } = evaluateProduct(result.product);
    expect(metrics.dryerSafe).toMatchObject({ source: "image-vision", confidence: "medium" });
    expect(metrics.washEase).toMatchObject({ source: "image-vision", confidence: "medium" });
    expect(metrics.dryerSafe.reason).toContain("상세 이미지");
    expect(metrics.naturalFiberRatio).toMatchObject({ source: "image-vision" });
  });

  it("keeps going with what it has when the model fails", async () => {
    const { provider } = visionProvider({}, new ExtractionProviderError("quota"));
    const result = await run(imageOnly, provider, { postJson: async () => ({ ok: false as const }) });
    if (!result.ok) throw new Error("expected a product");
    expect(result.product.materials).toEqual([]);
    expect(result.product.extractionMetadata?.vision).toMatchObject({ status: "failed", reason: "quota" });
    expect(result.product.extractionMetadata?.warnings.join(" ")).toContain("상세 이미지 분석에 문제가");
    expect(JSON.stringify(result.product.extractionMetadata)).not.toContain("RESOURCE");
  });

  it("skips images when the request has no time left", async () => {
    okImage.mockClear();
    const { provider, extractFromImages } = visionProvider({ materials: imageMaterials });
    const result = await run(imageOnly, provider, { budgetMs: 3000, postJson: async () => ({ ok: false as const }) });
    if (!result.ok) throw new Error("expected a product");
    expect(extractFromImages).not.toHaveBeenCalled();
    expect(okImage).not.toHaveBeenCalled();
    expect(result.product.extractionMetadata?.vision).toMatchObject({ status: "skipped", reason: "no_time" });
    expect(result.product.extractionMetadata?.warnings.join(" ")).toContain("시간이 부족");
  });

  it("does nothing for pages that are not Zigzag products", async () => {
    const { provider, extractFromImages } = visionProvider({ materials: imageMaterials });
    const result = await extractProductFromUrl(
      "https://shop.example.com/knit",
      provider,
      async (url) => ({ ok: true as const, html: "<html><head><title>니트</title></head><body>상세는 이미지</body></html>", finalUrl: url }),
      passThrough,
      { postJson: okPost, fetchImage: okImage },
    );
    expect(result.ok).toBe(true);
    expect(extractFromImages).not.toHaveBeenCalled();
  });
});

describe("image selection and limits", () => {
  it("keeps the first two and the last images when there are too many", () => {
    const urls = Array.from({ length: 20 }, (_, index) => `https://img.example.com/${index}.jpg`);
    const picked = pickDetailImages(urls);
    expect(picked).toHaveLength(VISION_LIMITS.maxImages);
    expect(picked.slice(0, 2)).toEqual(urls.slice(0, 2));
    expect(picked.slice(2)).toEqual(urls.slice(-6));
  });

  it("keeps a short list as it is, without duplicates", () => {
    expect(pickDetailImages(["a", "b", "a"])).toEqual(["a", "b"]);
  });

  it("downloads a limited number in parallel and skips what fails", async () => {
    let active = 0;
    let peak = 0;
    const fetchImage = vi.fn(async (url: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return url.includes("bad") ? { ok: false as const, code: "fetch_failed" as const, message: "x" } : image;
    });
    const { images, skipped } = await loadDetailImages(["a", "bad1", "b", "bad2", "c", "d"], fetchImage, 1000);
    expect(images).toHaveLength(4);
    expect(skipped).toBe(2);
    expect(peak).toBeLessThanOrEqual(VISION_LIMITS.concurrency);
  });

  it("stops adding images once the byte budget is spent", async () => {
    const big = { ok: true as const, bytes: Buffer.alloc(4_000_000), mimeType: "image/jpeg", finalUrl: "x" };
    const { images, skipped } = await loadDetailImages(["a", "b", "c", "d"], async () => big, 1000);
    expect(images).toHaveLength(2); // 8MB fits, a third would pass the 10MB cap
    expect(skipped).toBe(2);
  });

  it("never sends more than the limit to the model", async () => {
    const urls = Array.from({ length: 30 }, (_, index) => `https://img.example.com/${index}.jpg`);
    const { provider, extractFromImages } = visionProvider({ materials: imageMaterials });
    const product = { productName: "x", materials: [], sizes: [], careInstructions: [], images: [], description: "", category: "knitwear", factsSource: "product_page", extractionMetadata: { strategy: ["hydration"], status: "partial", confidence: "medium", aiProvider: "unavailable", warnings: [] } } as unknown as ProductFacts;
    const outcome = await runVisionFallback({ product, imageUrls: urls, provider, remainingMs: 40_000, fetchImage: okImage, pageUrl: PAGE });
    expect(extractFromImages.mock.calls[0][0].images).toHaveLength(VISION_LIMITS.maxImages);
    expect(outcome.product.extractionMetadata?.vision).toMatchObject({ imagesRead: VISION_LIMITS.maxImages, imagesSkipped: 22 });
  });

  it("is skipped quietly when the provider cannot see or there are no detail images", async () => {
    const base = { productName: "x", materials: [], sizes: [], careInstructions: [], images: [], description: "", category: "knitwear", factsSource: "product_page", extractionMetadata: { strategy: [], status: "partial", confidence: "low", aiProvider: "unavailable", warnings: [] } } as unknown as ProductFacts;
    const blind: ProductExtractionProvider = { providerName: "unavailable", isAvailable: () => false, extract: async () => ({ product: {}, confidence: "low", warnings: [] }) };
    const none = await runVisionFallback({ product: base, imageUrls: ["https://img.example.com/1.jpg"], provider: blind, remainingMs: 40_000, fetchImage: okImage, pageUrl: PAGE });
    expect(none.product.extractionMetadata?.vision).toMatchObject({ status: "skipped", reason: "vision_unavailable" });
    expect(none.warnings).toEqual([]);

    const { provider } = visionProvider();
    const noImages = await runVisionFallback({ product: base, imageUrls: [], provider, remainingMs: 40_000, fetchImage: okImage, pageUrl: PAGE });
    expect(noImages.product.extractionMetadata?.vision).toMatchObject({ status: "skipped", reason: "no_detail_images" });
  });

  it("reports an image set that could not be downloaded", async () => {
    const { provider, extractFromImages } = visionProvider();
    const base = { productName: "x", materials: [], sizes: [], careInstructions: [], images: [], description: "", category: "knitwear", factsSource: "product_page", extractionMetadata: { strategy: [], status: "partial", confidence: "low", aiProvider: "unavailable", warnings: [] } } as unknown as ProductFacts;
    const outcome = await runVisionFallback({
      product: base,
      imageUrls: ["https://img.example.com/1.jpg"],
      provider,
      remainingMs: 40_000,
      fetchImage: async () => ({ ok: false, code: "blocked_url", message: "x" }),
      pageUrl: PAGE,
    });
    expect(extractFromImages).not.toHaveBeenCalled();
    expect(outcome.product.extractionMetadata?.vision).toMatchObject({ status: "failed", reason: "images_unreadable" });
  });
});

describe("collecting the detail images", () => {
  it("takes https images in page order, preferring lazy-load attributes, and skips icons, SVG, GIF and duplicates", () => {
    const html = [
      '<img src="https://img.example.com/1.jpg">',
      '<img ec-data-src="https://img.example.com/lazy.jpg" src="https://img.example.com/placeholder.gif">',
      '<img src="//img.example.com/protocol-relative.png">',
      '<img src="https://img.example.com/1.jpg">',
      '<img src="http://img.example.com/insecure.jpg">',
      '<img src="https://img.example.com/icon_new.png">',
      '<img src="https://img.example.com/vector.svg">',
      '<img src="https://img.example.com/anim.gif">',
      '<img src="data:image/png;base64,AAAA">',
    ].join("");
    const adapter = extractZigzagProduct(zigzagPage({ detailHtml: html }))!;
    expect(adapter.detailImageUrls).toEqual(["https://img.example.com/1.jpg", "https://img.example.com/lazy.jpg", "https://img.example.com/protocol-relative.png"]);
  });
});
