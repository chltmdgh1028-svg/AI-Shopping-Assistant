// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { validateHttpUrl, type UrlSafetyResult } from "@/lib/urlSafety";
import { FETCH_LIMITS, fetchPublicImage, fetchPublicJson } from "@/services/extraction/safeFetch";

let server: http.Server;
let base = "";
const hits: string[] = [];
const received: Array<{ method?: string; type?: string; body: string }> = [];

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);

beforeAll(async () => {
  server = http.createServer((request, response) => {
    const path = request.url ?? "/";
    hits.push(path);
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ method: request.method, type: String(request.headers["content-type"] ?? ""), body: Buffer.concat(chunks).toString("utf-8") });

      if (path === "/a.jpg") {
        response.writeHead(200, { "content-type": "image/jpeg" });
        return response.end(jpeg);
      }
      if (path === "/b.png") {
        response.writeHead(200, { "content-type": "image/png; charset=binary" });
        return response.end(jpeg);
      }
      if (path === "/anim.gif") {
        response.writeHead(200, { "content-type": "image/gif" });
        return response.end(jpeg);
      }
      if (path === "/page.html") {
        response.writeHead(200, { "content-type": "text/html" });
        return response.end("<html></html>");
      }
      if (path === "/huge.jpg") {
        response.writeHead(200, { "content-type": "image/jpeg" });
        return response.end(Buffer.alloc(FETCH_LIMITS.maxImageBytes + 10));
      }
      if (path === "/redirect-private.jpg") {
        response.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/x.jpg" });
        return response.end();
      }
      if (path === "/api") {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        return response.end(JSON.stringify({ data: { ok: true } }));
      }
      if (path === "/api-html") {
        response.writeHead(200, { "content-type": "text/html" });
        return response.end("<html></html>");
      }
      if (path === "/api-broken") {
        response.writeHead(200, { "content-type": "application/json" });
        return response.end("{not json");
      }
      if (path === "/api-redirect") {
        response.writeHead(302, { location: "/api" });
        return response.end();
      }
      response.writeHead(404);
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

const allowLocalOnly = (rawUrl: string): UrlSafetyResult => {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:") return { ok: false, reason: "unsupported_protocol" };
  if (parsed.hostname === "127.0.0.1") return { ok: true, url: parsed };
  return validateHttpUrl(rawUrl);
};

const deps = { validateUrl: allowLocalOnly, isBlockedAddress: () => false, limits: { ...FETCH_LIMITS, timeoutMs: 800 } };

describe("fetchPublicImage", () => {
  it("returns the bytes and the MIME type of a JPEG", async () => {
    const result = await fetchPublicImage(`${base}/a.jpg`, deps);
    expect(result).toMatchObject({ ok: true, mimeType: "image/jpeg" });
    expect(result.ok && result.bytes.equals(jpeg)).toBe(true);
  });

  it("accepts PNG with a charset parameter", async () => {
    expect(await fetchPublicImage(`${base}/b.png`, deps)).toMatchObject({ ok: true, mimeType: "image/png" });
  });

  it("refuses GIF (animated, and not a format the model reads), HTML and unknown paths", async () => {
    expect(await fetchPublicImage(`${base}/anim.gif`, deps)).toMatchObject({ ok: false, code: "unsupported_content" });
    expect(await fetchPublicImage(`${base}/page.html`, deps)).toMatchObject({ ok: false, code: "unsupported_content" });
    expect(await fetchPublicImage(`${base}/nope.jpg`, deps)).toMatchObject({ ok: false, code: "fetch_failed" });
  });

  it("stops at the per-image size cap", async () => {
    expect(await fetchPublicImage(`${base}/huge.jpg`, deps)).toMatchObject({ ok: false, code: "too_large" });
  });

  it("re-validates a redirect: it never follows one to a private address", async () => {
    expect(await fetchPublicImage(`${base}/redirect-private.jpg`, deps)).toMatchObject({ ok: false, code: "blocked_url" });
    expect(hits).not.toContain("/latest/meta-data/x.jpg");
  });

  it("refuses private and non-http addresses outright", async () => {
    for (const url of ["http://169.254.169.254/a.jpg", "http://127.0.0.1/a.jpg", "file:///etc/passwd", "ftp://example.com/a.jpg"]) {
      expect(await fetchPublicImage(url), url).toMatchObject({ ok: false });
    }
  });
});

describe("fetchPublicJson", () => {
  it("POSTs the body as JSON and parses the answer", async () => {
    const result = await fetchPublicJson(`${base}/api`, { query: "q", variables: { id: "1" } }, deps);
    expect(result).toEqual({ ok: true, data: { data: { ok: true } } });
    const sent = received.filter((entry) => entry.method === "POST").at(-1)!;
    expect(sent.type).toContain("application/json");
    expect(JSON.parse(sent.body)).toEqual({ query: "q", variables: { id: "1" } });
  });

  it("does not accept HTML, broken JSON or a redirect as an answer", async () => {
    expect(await fetchPublicJson(`${base}/api-html`, {}, deps)).toMatchObject({ ok: false, code: "unsupported_content" });
    expect(await fetchPublicJson(`${base}/api-broken`, {}, deps)).toMatchObject({ ok: false, code: "fetch_failed" });
    expect(await fetchPublicJson(`${base}/api-redirect`, {}, deps)).toMatchObject({ ok: false });
  });

  it("refuses private addresses without sending anything", async () => {
    const before = received.length;
    expect(await fetchPublicJson("http://169.254.169.254/graphql", {})).toMatchObject({ ok: false, code: "blocked_url" });
    expect(await fetchPublicJson("http://localhost:3000/graphql", {})).toMatchObject({ ok: false, code: "blocked_url" });
    expect(received.length).toBe(before);
  });
});
