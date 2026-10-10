// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveProductUrl, UNRESOLVED_MESSAGE } from "@/services/extraction/resolution";
import { GenericRedirectResolver } from "@/services/extraction/resolution/genericRedirectResolver";
import { ZigzagResolver } from "@/services/extraction/resolution/zigzagResolver";
import type { HopOutcome } from "@/services/extraction/safeFetch";

const SHARE = "https://s.zigzag.kr/EsIGneY1F0";

// What s.zigzag.kr really answers (October 2026): a 301 to a tracking redirect whose query holds the app link
// (with the product id and the store URL) and a desktop fallback.
const TRACKING =
  "https://abr.ge/@zigzag/sharelink?channel=sharelink&campaign=product&ad_group=normal" +
  "&deeplink_url=zigzag%3A%2F%2Fopen%2Fproduct_detail%3Fbrowsing_type%3DINTERNAL_BROWSER%26catalog_product_id%3D172008665" +
  "%26url%3Dhttps%3A%2F%2Fstore.zigzag.kr%2Fapp%2Fcatalog%2Fproducts%2F172008665%3Fcatalog_product_id%3D172008665%26shop_id%3D61103%26uau%3Da1a5edff" +
  "&fallback_desktop=https%3A%2F%2Fzigzag.kr%2Fp%2F172008665";

const redirect = (location: string): HopOutcome => ({ kind: "redirect", location });
const page = (html: string, finalUrl = "https://s.zigzag.kr/x"): HopOutcome => ({ kind: "page", html, finalUrl });

/** A scripted network: each URL answers once, in order. Every request is recorded. */
function network(script: Record<string, HopOutcome | HopOutcome[]>) {
  const calls: string[] = [];
  const queues = new Map(Object.entries(script).map(([url, outcome]) => [url, Array.isArray(outcome) ? [...outcome] : [outcome]]));
  return {
    calls,
    context: {
      hop: async (url: string): Promise<HopOutcome> => {
        calls.push(url);
        return queues.get(url)?.shift() ?? { ok: false, code: "fetch_failed", message: "no scripted answer" };
      },
    },
  };
}

describe("which links get resolved", () => {
  it("recognises the Zigzag share host and nothing else", () => {
    const zigzag = new ZigzagResolver();
    expect(zigzag.matches(new URL(SHARE))).toBe(true);
    expect(zigzag.matches(new URL("https://S.ZIGZAG.KR/abc"))).toBe(true);
    for (const other of ["https://zigzag.kr/p/172008665", "https://www.zigzag.kr/", "https://store.zigzag.kr/catalog/products/1", "https://evil-s.zigzag.kr.example.com/x"]) {
      expect(zigzag.matches(new URL(other)), other).toBe(false);
    }
  });

  it("lets an ordinary Zigzag product URL through without any request", async () => {
    const net = network({});
    const result = await resolveProductUrl("https://zigzag.kr/p/172008665", { context: net.context });
    expect(result).toMatchObject({ ok: true, provider: "none", resolutionType: "none", canonicalUrl: "https://zigzag.kr/p/172008665", redirectCount: 0 });
    expect(net.calls).toEqual([]);
  });

  it("lets any other shop URL through unchanged", async () => {
    const net = network({});
    const result = await resolveProductUrl("https://shop.example.com/knit?id=1", { context: net.context });
    expect(result).toMatchObject({ ok: true, provider: "none", canonicalUrl: "https://shop.example.com/knit?id=1" });
    expect(net.calls).toEqual([]);
  });

  it("rejects an invalid or private input before anything is requested", async () => {
    const net = network({});
    expect(await resolveProductUrl("not a url", { context: net.context })).toMatchObject({ ok: false, code: "invalid_url" });
    expect(await resolveProductUrl("http://127.0.0.1/", { context: net.context })).toMatchObject({ ok: false, code: "blocked_url" });
    expect(net.calls).toEqual([]);
  });
});

describe("Zigzag share link", () => {
  it("resolves the real redirect to the product page and records the trace", async () => {
    const net = network({ [SHARE]: redirect(TRACKING) });
    const result = await resolveProductUrl(SHARE, { context: net.context });

    expect(result).toEqual({
      ok: true,
      inputUrl: SHARE,
      canonicalUrl: "https://zigzag.kr/p/172008665",
      provider: "zigzag",
      resolutionType: "short-link",
      redirectCount: 1,
      extractedProductId: "172008665",
    });
    // The tracking redirect already spells out the destination, so it is never even requested.
    expect(net.calls).toEqual([SHARE]);
  });

  it("drops tracking parameters from the canonical URL", async () => {
    const net = network({ [SHARE]: redirect(TRACKING) });
    const result = await resolveProductUrl(SHARE, { context: net.context });
    expect(result.ok && result.canonicalUrl).not.toContain("?");
    expect(JSON.stringify(result)).not.toContain("uau=");
  });

  it("falls back to the app link's own store URL when there is no desktop fallback", async () => {
    const location =
      "https://abr.ge/x?deeplink_url=" +
      encodeURIComponent("zigzag://open/product_detail?catalog_product_id=555&url=https://store.zigzag.kr/app/catalog/products/555?shop_id=1");
    const net = network({ [SHARE]: redirect(location) });
    expect(await resolveProductUrl(SHARE, { context: net.context })).toMatchObject({
      ok: true,
      canonicalUrl: "https://store.zigzag.kr/app/catalog/products/555",
      resolutionType: "deep-link",
      extractedProductId: "555",
    });
  });

  it("builds zigzag.kr/p/<id> from a bare product id, and says it did", async () => {
    const location = "https://abr.ge/x?deeplink_url=" + encodeURIComponent("zigzag://open/product_detail?catalog_product_id=777");
    const net = network({ [SHARE]: redirect(location) });
    expect(await resolveProductUrl(SHARE, { context: net.context })).toMatchObject({
      ok: true,
      canonicalUrl: "https://zigzag.kr/p/777",
      extractedProductId: "777",
      derivedFromId: true,
    });
  });

  it("reads an app-scheme Location without ever requesting it", async () => {
    const net = network({ [SHARE]: redirect("zigzag://open/product_detail?catalog_product_id=888") });
    const result = await resolveProductUrl(SHARE, { context: net.context });
    expect(result).toMatchObject({ ok: true, canonicalUrl: "https://zigzag.kr/p/888", derivedFromId: true });
    expect(net.calls).toEqual([SHARE]);
  });

  it("reads an intent:// link and its browser fallback", async () => {
    const intent =
      "intent://open/product_detail?catalog_product_id=999#Intent;scheme=zigzag;package=com.croquis.zigzag;S.browser_fallback_url=" +
      encodeURIComponent("https://zigzag.kr/p/999") +
      ";end";
    const net = network({ [SHARE]: redirect(intent) });
    expect(await resolveProductUrl(SHARE, { context: net.context })).toMatchObject({ ok: true, canonicalUrl: "https://zigzag.kr/p/999", resolutionType: "deep-link" });
    expect(net.calls).toEqual([SHARE]);
  });

  it("follows plain HTTP redirects until the product page shows up", async () => {
    const net = network({
      [SHARE]: redirect("https://hop.example.org/a"),
      "https://hop.example.org/a": redirect("https://zigzag.kr/p/321?utm=x"),
    });
    const result = await resolveProductUrl(SHARE, { context: net.context });
    expect(result).toMatchObject({ ok: true, canonicalUrl: "https://zigzag.kr/p/321", redirectCount: 2, extractedProductId: "321" });
  });

  it.each([
    ["a meta refresh", '<html><head><meta http-equiv="refresh" content="0; url=https://zigzag.kr/p/222"></head></html>', "https://zigzag.kr/p/222"],
    ["a script redirect", '<script>window.location.href = "https://store.zigzag.kr/app/catalog/products/333";</script>', "https://store.zigzag.kr/app/catalog/products/333"],
    ["location.replace", "<script>location.replace('https://zigzag.kr/p/334')</script>", "https://zigzag.kr/p/334"],
    ["an app link in the page", '<a href="zigzag://open/product_detail?catalog_product_id=444">open</a>', "https://zigzag.kr/p/444"],
    ["a fallback field in script data", '<script>var cfg={"fallback_desktop":"https:\\/\\/zigzag.kr\\/p\\/555"}</script>', "https://zigzag.kr/p/555"],
  ])("finds the product page in %s", async (_name, html, expected) => {
    const net = network({ [SHARE]: page(html) });
    const result = await resolveProductUrl(SHARE, { context: net.context });
    expect(result).toMatchObject({ ok: true, canonicalUrl: expected });
  });

  it("reports an unresolved link when nothing points at a product", async () => {
    const net = network({ [SHARE]: page("<html><body>다운로드</body></html>") });
    expect(await resolveProductUrl(SHARE, { context: net.context })).toEqual({ ok: false, code: "unresolved_share_link", message: UNRESOLVED_MESSAGE });
  });

  it("does not accept a destination outside Zigzag", async () => {
    const location = "https://abr.ge/x?fallback_desktop=" + encodeURIComponent("https://evil.example.com/p/1") + "&url=https%3A%2F%2Fevil.example.com%2Fp%2F2";
    const net = network({ [SHARE]: redirect(location), "https://abr.ge/x?fallback_desktop=https%3A%2F%2Fevil.example.com%2Fp%2F1&url=https%3A%2F%2Fevil.example.com%2Fp%2F2": page("") });
    expect(await resolveProductUrl(SHARE, { context: net.context })).toMatchObject({ ok: false, code: "unresolved_share_link" });
  });
});

describe("redirect safety", () => {
  it.each([
    "http://169.254.169.254/latest/meta-data",
    "http://127.0.0.1/",
    "http://localhost/admin",
    "http://10.0.0.5/",
    "http://[::1]/",
    "http://metadata.google.internal/",
    "https://zigzag.kr:8443/p/1",
  ])("re-validates every redirect destination: %s", async (target) => {
    const net = network({ [SHARE]: redirect(target) });
    const result = await resolveProductUrl(SHARE, { context: net.context });
    expect(result).toMatchObject({ ok: false, code: "blocked_url" });
    expect(net.calls).toEqual([SHARE]); // the destination was never requested
  });

  it("never uses a private address that a link parameter points at", async () => {
    const location = "https://abr.ge/x?fallback_desktop=" + encodeURIComponent("http://169.254.169.254/p/1");
    const net = network({ [SHARE]: redirect(location), [location]: page("") });
    const result = await resolveProductUrl(SHARE, { context: net.context });
    expect(result.ok).toBe(false);
    expect(net.calls).not.toContain("http://169.254.169.254/p/1");
  });

  it.each(["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<script>alert(1)</script>", "ftp://example.com/a", "vbscript:msgbox(1)"])(
    "ignores the dangerous scheme %s",
    async (location) => {
      const net = network({ [SHARE]: redirect(location) });
      expect(await resolveProductUrl(SHARE, { context: net.context })).toMatchObject({ ok: false, code: "unresolved_share_link" });
      expect(net.calls).toEqual([SHARE]);
    },
  );

  it("ignores dangerous schemes written inside a page", async () => {
    const net = network({ [SHARE]: page('<a href="javascript:alert(1)">x</a><script>location.href="javascript:alert(2)"</script>') });
    expect(await resolveProductUrl(SHARE, { context: net.context })).toMatchObject({ ok: false, code: "unresolved_share_link" });
  });

  it("stops a redirect loop", async () => {
    const a = "https://hop.example.org/a";
    const b = "https://hop.example.org/b";
    const net = network({ [SHARE]: redirect(a), [a]: redirect(b), [b]: redirect(a) });
    expect(await resolveProductUrl(SHARE, { context: net.context })).toMatchObject({ ok: false, code: "unresolved_share_link" });
    expect(net.calls.length).toBeLessThanOrEqual(4);
  });

  it("stops after the redirect limit", async () => {
    const script: Record<string, HopOutcome> = {};
    for (let i = 0; i < 20; i += 1) script[i === 0 ? SHARE : `https://hop.example.org/${i}`] = redirect(`https://hop.example.org/${i + 1}`);
    const net = network(script);
    const result = await resolveProductUrl(SHARE, { context: { ...net.context, maxRedirects: 3 } });
    expect(result).toMatchObject({ ok: false, code: "unresolved_share_link" });
    expect(net.calls).toHaveLength(4);
  });

  it("gives up when the time budget is spent", async () => {
    let clock = 1000;
    const net = network({ [SHARE]: redirect("https://hop.example.org/a") });
    const result = await resolveProductUrl(SHARE, {
      context: { ...net.context, now: () => (clock += 2500), deadline: 1000 + 5000 },
    });
    expect(result).toMatchObject({ ok: false, code: "unresolved_share_link" });
    expect(net.calls.length).toBeLessThanOrEqual(2);
  });

  it("treats a failed hop as unresolved, and a blocked hop as blocked", async () => {
    expect(await resolveProductUrl(SHARE, { context: network({ [SHARE]: { ok: false, code: "fetch_failed", message: "x" } }).context })).toMatchObject({
      ok: false,
      code: "unresolved_share_link",
    });
    expect(await resolveProductUrl(SHARE, { context: network({ [SHARE]: { ok: false, code: "blocked_url", message: "막힘" } }).context })).toMatchObject({
      ok: false,
      code: "blocked_url",
    });
  });

  it("never lets a key or token into the trace", async () => {
    const net = network({ [SHARE]: redirect(TRACKING + "&api_key=SECRET-123") });
    const result = await resolveProductUrl(SHARE, { context: net.context });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});

describe("generic redirect resolver", () => {
  const generic = [new GenericRedirectResolver()];

  it("follows a known shortener to the shop page without fetching the shop", async () => {
    const net = network({ "https://bit.ly/3abc": redirect("https://shop.example.com/product/9?utm=a") });
    const result = await resolveProductUrl("https://bit.ly/3abc", { resolvers: generic, context: net.context });
    expect(result).toMatchObject({ ok: true, provider: "generic", canonicalUrl: "https://shop.example.com/product/9?utm=a" });
    expect(net.calls).toEqual(["https://bit.ly/3abc"]);
  });

  it("reads the destination out of a deep-link service URL", async () => {
    const link = "https://abr.ge/x?fallback_desktop=" + encodeURIComponent("https://shop.example.com/item/5");
    const net = network({});
    const result = await resolveProductUrl(link, { resolvers: generic, context: net.context });
    expect(result).toMatchObject({ ok: true, canonicalUrl: "https://shop.example.com/item/5" });
    expect(net.calls).toEqual([]);
  });

  it("does not touch a normal product URL", async () => {
    const net = network({});
    const result = await resolveProductUrl("https://shop.example.com/item/5", { resolvers: generic, context: net.context });
    expect(result).toMatchObject({ ok: true, provider: "none" });
    expect(net.calls).toEqual([]);
  });
});
