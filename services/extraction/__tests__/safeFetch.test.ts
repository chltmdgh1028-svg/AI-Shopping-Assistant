// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateHttpUrl, type UrlSafetyResult } from "@/lib/urlSafety";
import { FETCH_LIMITS, fetchPublicHtml } from "@/services/extraction/safeFetch";

// A real local server. The public guards would (correctly) refuse 127.0.0.1, so the tests inject a
// validator that allows only this server's host and a block-list that stands in for "private".
let server: http.Server;
let base = "";
const hits: string[] = [];

const euckrBody = Buffer.from([0xbf, 0xef, 0x20, 0xb4, 0xcf, 0xc6, 0xae]); // "울 니트" in EUC-KR

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const path = request.url ?? "/";
    hits.push(path);

    if (path === "/ok") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end("<html><title>ok page</title></html>");
    }
    if (path === "/gzip") {
      response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      return response.end(gzipSync("<html><title>zipped</title></html>"));
    }
    if (path === "/euckr") {
      response.writeHead(200, { "content-type": "text/html; charset=euc-kr" });
      return response.end(Buffer.concat([Buffer.from("<html><title>"), euckrBody, Buffer.from("</title></html>")]));
    }
    if (path === "/redirect-ok") {
      response.writeHead(302, { location: "/ok" });
      return response.end();
    }
    if (path === "/redirect-private") {
      response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      return response.end();
    }
    if (path === "/loop") {
      response.writeHead(302, { location: "/loop" });
      return response.end();
    }
    if (path === "/json") {
      response.writeHead(200, { "content-type": "application/json" });
      return response.end("{}");
    }
    if (path === "/big") {
      response.writeHead(200, { "content-type": "text/html" });
      return response.end("x".repeat(FETCH_LIMITS.maxBytes + 10));
    }
    if (path === "/bomb") {
      response.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
      return response.end(gzipSync("a".repeat(FETCH_LIMITS.maxBytes * 3)));
    }
    if (path === "/slow") {
      return void setTimeout(() => response.end("late"), 1500);
    }
    if (path === "/missing") {
      response.writeHead(404, { "content-type": "text/html" });
      return response.end("nope");
    }
    response.writeHead(500);
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const allowLocalOnly = (rawUrl: string): UrlSafetyResult => {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:") return { ok: false, reason: "unsupported_protocol" };
  // Mirrors the production rule for everything except the test server's own host.
  if (parsed.hostname === "127.0.0.1") return { ok: true, url: parsed };
  return validateHttpUrl(rawUrl);
};

const deps = { validateUrl: allowLocalOnly, isBlockedAddress: () => false, limits: { ...FETCH_LIMITS, timeoutMs: 600 } };

describe("fetchPublicHtml", () => {
  it("returns the HTML of a normal page", async () => {
    const result = await fetchPublicHtml(`${base}/ok`, deps);
    expect(result).toMatchObject({ ok: true, finalUrl: `${base}/ok` });
    expect(result.ok && result.html).toContain("ok page");
  });

  it("decodes gzip responses", async () => {
    const result = await fetchPublicHtml(`${base}/gzip`, deps);
    expect(result.ok && result.html).toContain("zipped");
  });

  it("decodes EUC-KR pages instead of returning mojibake", async () => {
    const result = await fetchPublicHtml(`${base}/euckr`, deps);
    expect(result.ok && result.html).toContain("울 니트");
  });

  it("follows a redirect and reports the final URL", async () => {
    const result = await fetchPublicHtml(`${base}/redirect-ok`, deps);
    expect(result).toMatchObject({ ok: true, finalUrl: `${base}/ok` });
  });

  it("re-validates redirect targets: a redirect to a metadata address is refused", async () => {
    const result = await fetchPublicHtml(`${base}/redirect-private`, deps);
    expect(result).toMatchObject({ ok: false, code: "blocked_url" });
    expect(hits).not.toContain("/latest/meta-data");
  });

  it("stops redirect loops", async () => {
    const result = await fetchPublicHtml(`${base}/loop`, deps);
    expect(result).toMatchObject({ ok: false, code: "fetch_failed" });
  });

  it("rejects non-HTML content types", async () => {
    expect(await fetchPublicHtml(`${base}/json`, deps)).toMatchObject({ ok: false, code: "unsupported_content" });
  });

  it("rejects oversized pages, including a small gzip that expands past the limit", async () => {
    expect(await fetchPublicHtml(`${base}/big`, deps)).toMatchObject({ ok: false, code: "too_large" });
    expect(await fetchPublicHtml(`${base}/bomb`, deps)).toMatchObject({ ok: false, code: "too_large" });
  });

  it("reports HTTP errors", async () => {
    const result = await fetchPublicHtml(`${base}/missing`, deps);
    expect(result).toMatchObject({ ok: false, code: "fetch_failed" });
    expect(!result.ok && result.message).toContain("404");
  });

  it("gives up on a response that takes too long", async () => {
    const result = await fetchPublicHtml(`${base}/slow`, deps);
    expect(result).toMatchObject({ ok: false, code: "fetch_failed" });
  });

  it("refuses private targets with the real guards, before any connection is made", async () => {
    const before = hits.length;
    for (const url of [`${base}/ok`.replace("http://", "http://user:pw@"), "http://localhost/", "http://[::1]/", "http://10.0.0.1/", "file:///etc/passwd"]) {
      expect(await fetchPublicHtml(url), url).toMatchObject({ ok: false });
    }
    expect(hits.length).toBe(before);
  });

  it("blocks a host that resolves to a blocked address at connection time", async () => {
    // A validator that only looks at the URL text lets "localhost" through; the lookup hook sees the
    // resolved 127.0.0.1 / ::1 and refuses before a socket is opened (DNS-rebinding style bypass).
    const before = hits.length;
    const result = await fetchPublicHtml(`http://localhost/ok`, {
      validateUrl: (rawUrl) => ({ ok: true, url: new URL(rawUrl) }),
      isBlockedAddress: (address) => address === "127.0.0.1" || address === "::1",
      limits: { ...FETCH_LIMITS, timeoutMs: 1500 },
    });
    expect(result).toMatchObject({ ok: false, code: "blocked_url" });
    expect(hits.length).toBe(before);
  });
});
