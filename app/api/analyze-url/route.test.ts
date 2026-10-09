// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analyze-url/route";

let counter = 0;
// Each test uses its own client IP so the in-memory throttle never leaks between tests.
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/analyze-url", {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": `10.9.${Math.floor(++counter / 250)}.${counter % 250}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/analyze-url", () => {
  it("requires JSON", async () => {
    const response = await POST(request("url=https://example.com", { "content-type": "text/plain" }));
    expect(response.status).toBe(415);
  });

  it("rejects malformed JSON and missing URLs", async () => {
    expect((await POST(request("{not json"))).status).toBe(400);
    expect((await POST(request({}))).status).toBe(400);
    expect((await POST(request({ url: 42 }))).status).toBe(400);
    expect((await POST(request({ url: "   " }))).status).toBe(400);
  });

  it("rejects oversized payloads", async () => {
    const response = await POST(request({ url: "https://example.com/" + "a".repeat(5000) }));
    expect(response.status).toBe(413);
  });

  it("refuses private and non-http targets without making a request", async () => {
    for (const url of ["http://127.0.0.1/", "http://localhost:3000/", "http://[::1]/", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd"]) {
      const response = await POST(request({ url }));
      const payload = (await response.json()) as { code: string };
      expect(response.status, url).toBe(400);
      expect(["blocked_url", "invalid_url"]).toContain(payload.code);
    }
  });

  it("answers with no-store caching", async () => {
    const response = await POST(request({ url: "http://127.0.0.1/" }));
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("throttles a single client and says when to retry", async () => {
    const headers = { "x-real-ip": "203.0.113.200" };
    let last: Response | undefined;
    for (let attempt = 0; attempt < 13; attempt += 1) {
      last = await POST(request({ url: "http://127.0.0.1/" }, headers));
    }
    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("never echoes the API key in responses, even when one is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "super-secret-test-key-123");
    const response = await POST(request({ url: "http://127.0.0.1/" }));
    expect(JSON.stringify(await response.json())).not.toContain("super-secret-test-key-123");
  });
});
