// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { evaluateProduct } from "@/domain/evaluation";
import type { ProductExtractionProvider } from "@/services/extraction/aiProvider";
import { resolveProductUrl } from "@/services/extraction/resolution";
import { extractProductFromUrl } from "@/services/extraction/urlExtraction";
import type { HopOutcome } from "@/services/extraction/safeFetch";
import { realisticDetailHtml, zigzagPage } from "./fixtures/zigzagPage";

const SHARE = "https://s.zigzag.kr/EsIGneY1F0";
const TRACKING =
  "https://abr.ge/@zigzag/sharelink?deeplink_url=zigzag%3A%2F%2Fopen%2Fproduct_detail%3Fcatalog_product_id%3D172008665&fallback_desktop=https%3A%2F%2Fzigzag.kr%2Fp%2F172008665";

function resolverWith(hop: (url: string) => Promise<HopOutcome>) {
  return (url: string) => resolveProductUrl(url, { context: { hop } });
}

const shareHop = async (url: string): Promise<HopOutcome> =>
  url === SHARE ? { kind: "redirect", location: TRACKING } : { ok: false, code: "fetch_failed", message: "unexpected request" };

const fetchPage = (html: string) =>
  vi.fn(async (url: string) => ({ ok: true as const, html, finalUrl: url }));

describe("pasting a Zigzag share link", () => {
  it("analyses the product behind it, with no browser rendering and no model", async () => {
    const fetcher = fetchPage(zigzagPage());
    const result = await extractProductFromUrl(SHARE, undefined, fetcher, resolverWith(shareHop));

    // The page that was fetched is the product page, never the share link.
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://zigzag.kr/p/172008665");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { product } = result;
    expect(product.productName).toContain("니트 가디건");
    expect(product.brand).toBe("베러뮤즈");
    expect(product.pricing).toMatchObject({ currentPrice: 29900, originalPrice: 39900, discountRate: 25 });
    expect(product.images[0]).toContain("zigzag.kr");
    expect(product.materials.map((item) => item.name)).toEqual(["Cotton", "Polyester", "PBT"]);
    expect(product.sizes[0]).toMatchObject({ name: "FREE", chest: 87 });
    expect(product.sourceUrl).toBe("https://zigzag.kr/p/172008665");
    expect(product.extractionMetadata?.strategy).toContain("hydration");
  });

  it("keeps the trace in the metadata, without any intermediate tracking address", async () => {
    const result = await extractProductFromUrl(SHARE, undefined, fetchPage(zigzagPage()), resolverWith(shareHop));
    if (!result.ok) throw new Error("expected a product");
    expect(result.product.extractionMetadata?.resolution).toEqual({
      provider: "zigzag",
      resolutionType: "short-link",
      inputUrl: SHARE,
      canonicalUrl: "https://zigzag.kr/p/172008665",
      redirectCount: 1,
      extractedProductId: "172008665",
      derivedFromId: undefined,
    });
    expect(JSON.stringify(result.product.extractionMetadata)).not.toContain("abr.ge");
  });

  it("feeds the page's real content to the model and lets the model fill only what is missing", async () => {
    const extract = vi.fn(async (input: { pageText: string }) => ({
      product: { materials: [{ name: "Wool", percentage: 100, source: "gemini-extracted" as const, confidence: "high" as const }], careInstructions: ["찬물 세탁"] },
      confidence: "high" as const,
      warnings: [],
      model: "gemini-3.5-flash-lite",
      seen: input.pageText,
    }));
    const provider: ProductExtractionProvider = { providerName: "gemini", isAvailable: () => true, extract: extract as unknown as ProductExtractionProvider["extract"] };

    const result = await extractProductFromUrl(SHARE, provider, fetchPage(zigzagPage()), resolverWith(shareHop));
    if (!result.ok) throw new Error("expected a product");

    expect(extract.mock.calls[0][0].pageText.startsWith("상품명:")).toBe(true);
    expect(extract.mock.calls[0][0].pageText).toContain("cotton 50% polyester 29% pbt 21%");
    // Exact values read from the page data are not overwritten by the model; the model fills the empty care list.
    expect(result.product.materials.map((item) => item.name)).toEqual(["Cotton", "Polyester", "PBT"]);
    expect(result.product.careInstructions).toEqual(["찬물 세탁"]);
    expect(result.product.extractionMetadata?.aiModel).toBe("gemini-3.5-flash-lite");
  });

  it("evaluates the result like any other product: viscose-free blend, estimated size, price judged", async () => {
    const result = await extractProductFromUrl(SHARE, undefined, fetchPage(zigzagPage()), resolverWith(shareHop));
    if (!result.ok) throw new Error("expected a product");
    const { metrics, value } = evaluateProduct(result.product);
    expect(metrics.naturalFiberRatio.score).toBe(50);
    expect(value.status).toBe("available");
  });

  it("confirms a 1+1 only from the page text, and then prices one piece", async () => {
    const detail = realisticDetailHtml + "<div><span>1+1 행사 상품입니다. 2개 구성으로 발송됩니다.</span></div>";
    const result = await extractProductFromUrl(SHARE, undefined, fetchPage(zigzagPage({ name: "[1+1] 니트 가디건", detailHtml: detail })), resolverWith(shareHop));
    if (!result.ok) throw new Error("expected a product");
    expect(result.product.pricing).toMatchObject({ bundleQuantity: 2, unitPrice: 14950 });

    const labelOnly = await extractProductFromUrl(SHARE, undefined, fetchPage(zigzagPage({ name: "[1+1] 니트 가디건" })), resolverWith(shareHop));
    if (!labelOnly.ok) throw new Error("expected a product");
    expect(labelOnly.product.pricing?.bundleQuantity).toBeUndefined();
    expect(labelOnly.product.pricing?.bundleUnconfirmed).toBe(true);
  });
});

describe("when the share link cannot be resolved", () => {
  it("answers with the plain message and never fetches a page", async () => {
    const fetcher = fetchPage(zigzagPage());
    const hop = async (): Promise<HopOutcome> => ({ kind: "page", html: "<html>앱을 설치하세요</html>", finalUrl: SHARE });
    const result = await extractProductFromUrl(SHARE, undefined, fetcher, resolverWith(hop));
    expect(result).toEqual({ ok: false, code: "unresolved_share_link", message: "이 공유 링크에서 실제 상품 페이지를 찾지 못했어요." });
    expect(fetcher).not.toHaveBeenCalled();
    // The wording does not push the work back to the user.
    expect(result.ok === false && result.message).not.toContain("다시 복사");
  });
});

describe("ordinary product URLs are unaffected", () => {
  it("fetches the pasted address itself and records no resolution", async () => {
    const html = '<html><head><title>울 니트</title></head><body>Wool 70% Nylon 30% 59,000원</body></html>';
    const fetcher = fetchPage(html);
    const result = await extractProductFromUrl("https://shop.example.com/knit", undefined, fetcher);
    expect(fetcher).toHaveBeenCalledWith("https://shop.example.com/knit");
    if (!result.ok) throw new Error("expected a product");
    expect(result.product.extractionMetadata?.resolution).toBeUndefined();
    expect(result.product.materials.map((item) => item.name)).toEqual(["Wool", "Nylon"]);
  });

  it("opens a normal Zigzag product URL directly, and reads it with the adapter", async () => {
    const fetcher = fetchPage(zigzagPage());
    const result = await extractProductFromUrl("https://zigzag.kr/p/172008665", undefined, fetcher);
    expect(fetcher).toHaveBeenCalledWith("https://zigzag.kr/p/172008665");
    if (!result.ok) throw new Error("expected a product");
    expect(result.product.extractionMetadata?.resolution).toBeUndefined();
    expect(result.product.pricing?.currentPrice).toBe(29900);
  });

  it("still refuses private addresses", async () => {
    const result = await extractProductFromUrl("http://169.254.169.254/latest", undefined, fetchPage(""));
    expect(result).toMatchObject({ ok: false, code: "blocked_url" });
  });
});
