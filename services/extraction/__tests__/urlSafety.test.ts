import { describe, expect, it } from "vitest";
import { validateHttpUrl } from "@/lib/urlSafety";

describe("validateHttpUrl", () => {
  it("allows public http and https URLs", () => {
    expect(validateHttpUrl("https://example.com/product").ok).toBe(true);
    expect(validateHttpUrl("http://example.com/product").ok).toBe(true);
  });

  it("rejects invalid and unsupported URLs", () => {
    expect(validateHttpUrl("not a url")).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(validateHttpUrl("file:///etc/passwd")).toMatchObject({ ok: false, reason: "unsupported_protocol" });
  });

  it("blocks localhost and private IP targets", () => {
    expect(validateHttpUrl("http://localhost:3000")).toMatchObject({ ok: false });
    expect(validateHttpUrl("http://127.0.0.1:3000")).toMatchObject({ ok: false });
    expect(validateHttpUrl("http://10.0.0.4/product")).toMatchObject({ ok: false });
    expect(validateHttpUrl("http://172.16.0.4/product")).toMatchObject({ ok: false });
    expect(validateHttpUrl("http://192.168.0.4/product")).toMatchObject({ ok: false });
    expect(validateHttpUrl("http://169.254.169.254/latest/meta-data")).toMatchObject({ ok: false });
  });
});
