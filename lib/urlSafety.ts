import { isIP } from "node:net";

const blockedHostnames = new Set(["localhost", "metadata.google.internal"]);

export type UrlSafetyResult =
  | { ok: true; url: URL }
  | { ok: false; reason: "invalid_url" | "unsupported_protocol" | "blocked_hostname" | "blocked_ip" };

export function validateHttpUrl(rawUrl: string): UrlSafetyResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol" };
  }

  const hostname = url.hostname.toLowerCase();
  if (blockedHostnames.has(hostname) || hostname.endsWith(".localhost")) {
    return { ok: false, reason: "blocked_hostname" };
  }

  if (isBlockedIp(hostname)) {
    return { ok: false, reason: "blocked_ip" };
  }

  return { ok: true, url };
}

export function isBlockedIp(value: string) {
  const ipVersion = isIP(value);
  if (ipVersion === 4) return isBlockedIpv4(value);
  if (ipVersion === 6) return isBlockedIpv6(value);
  return false;
}

function isBlockedIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    ip === "169.254.169.254"
  );
}

function isBlockedIpv6(ip: string) {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe80:")
  );
}

export function urlSafetyMessage(reason: Exclude<UrlSafetyResult, { ok: true }>["reason"]) {
  if (reason === "invalid_url") return "올바른 URL 형식이 아닙니다.";
  if (reason === "unsupported_protocol") return "http 또는 https 주소만 분석할 수 있습니다.";
  if (reason === "blocked_hostname") return "보안상 이 호스트는 자동 분석할 수 없습니다.";
  return "보안상 사설망 또는 로컬 네트워크 주소는 자동 분석할 수 없습니다.";
}
