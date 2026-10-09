import { describe, expect, it } from "vitest";
import { isBlockedIp, MAX_URL_LENGTH, validateHttpUrl } from "@/lib/urlSafety";

describe("validateHttpUrl", () => {
  it("allows public http and https URLs", () => {
    expect(validateHttpUrl("https://example.com/product").ok).toBe(true);
    expect(validateHttpUrl("http://example.com/product").ok).toBe(true);
    expect(validateHttpUrl("https://shop.example.co.kr:443/goods?id=1").ok).toBe(true);
    expect(validateHttpUrl("https://93.184.216.34/product").ok).toBe(true);
  });

  it("rejects invalid and unsupported URLs", () => {
    expect(validateHttpUrl("not a url")).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(validateHttpUrl("   ")).toMatchObject({ ok: false, reason: "invalid_url" });
    expect(validateHttpUrl("file:///etc/passwd")).toMatchObject({ ok: false, reason: "unsupported_protocol" });
    expect(validateHttpUrl("ftp://example.com/a")).toMatchObject({ ok: false, reason: "unsupported_protocol" });
    expect(validateHttpUrl("javascript:alert(1)")).toMatchObject({ ok: false, reason: "unsupported_protocol" });
  });

  it("rejects over-long URLs", () => {
    const long = `https://example.com/${"a".repeat(MAX_URL_LENGTH)}`;
    expect(validateHttpUrl(long)).toMatchObject({ ok: false, reason: "url_too_long" });
  });

  it("rejects embedded credentials and unusual ports", () => {
    expect(validateHttpUrl("https://user:pass@example.com/")).toMatchObject({ ok: false, reason: "credentials_in_url" });
    expect(validateHttpUrl("http://example.com:8080/")).toMatchObject({ ok: false, reason: "blocked_port" });
    expect(validateHttpUrl("http://example.com:22/")).toMatchObject({ ok: false, reason: "blocked_port" });
  });

  it("blocks localhost and internal hostnames, including trailing-dot tricks", () => {
    for (const url of [
      "http://localhost:3000",
      "http://localhost/",
      "http://localhost./",
      "http://app.localhost/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://printer.local/",
      "http://intranet/",
    ]) {
      expect(validateHttpUrl(url), url).toMatchObject({ ok: false });
    }
  });

  it("blocks private, loopback and metadata IPv4 targets", () => {
    for (const ip of ["127.0.0.1", "10.0.0.4", "172.16.0.4", "172.31.255.1", "192.168.0.4", "169.254.169.254", "0.0.0.0", "100.64.0.1"]) {
      expect(validateHttpUrl(`http://${ip}/product`), ip).toMatchObject({ ok: false, reason: "blocked_ip" });
    }
  });

  it("blocks IPv4 written in alternative notations (the URL parser normalizes them)", () => {
    expect(validateHttpUrl("http://2130706433/")).toMatchObject({ ok: false });
    expect(validateHttpUrl("http://0x7f.0.0.1/")).toMatchObject({ ok: false });
    expect(validateHttpUrl("http://017700000001/")).toMatchObject({ ok: false });
  });

  it("blocks bracketed IPv6 loopback, private and mapped addresses", () => {
    for (const host of ["[::1]", "[::]", "[fe80::1]", "[fd00::1]", "[fc00::1]", "[::ffff:127.0.0.1]", "[::ffff:10.0.0.1]", "[::ffff:169.254.169.254]", "[64:ff9b::7f00:1]"]) {
      expect(validateHttpUrl(`http://${host}/`), host).toMatchObject({ ok: false, reason: "blocked_ip" });
    }
  });
});

describe("isBlockedIp", () => {
  it("allows public addresses", () => {
    expect(isBlockedIp("8.8.8.8")).toBe(false);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });

  it("blocks reserved and special-purpose ranges", () => {
    for (const ip of ["192.0.2.1", "198.18.0.1", "198.51.100.7", "203.0.113.9", "224.0.0.1", "255.255.255.255", "2001:db8::1", "ff02::1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("treats a bracketed IPv6 literal like the bare address", () => {
    expect(isBlockedIp("[::1]")).toBe(true);
    expect(isBlockedIp("::1")).toBe(true);
  });

  it("rejects malformed IP literals at the URL stage", () => {
    expect(validateHttpUrl("http://[::ffff:999.1.1.1]/")).toMatchObject({ ok: false, reason: "invalid_url" });
  });
});
