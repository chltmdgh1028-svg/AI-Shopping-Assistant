import { isIP } from "node:net";

export const MAX_URL_LENGTH = 2048;
const allowedPorts = new Set(["", "80", "443"]);
const blockedHostnames = new Set(["localhost", "metadata", "metadata.google.internal", "instance-data"]);
const blockedHostSuffixes = [".localhost", ".local", ".localdomain", ".internal", ".home.arpa", ".lan"];

export type UrlSafetyReason =
  | "invalid_url"
  | "url_too_long"
  | "unsupported_protocol"
  | "credentials_in_url"
  | "blocked_port"
  | "blocked_hostname"
  | "blocked_ip";

export type UrlSafetyResult = { ok: true; url: URL } | { ok: false; reason: UrlSafetyReason };

export function validateHttpUrl(rawUrl: string): UrlSafetyResult {
  const trimmed = rawUrl.trim();
  if (trimmed.length === 0) return { ok: false, reason: "invalid_url" };
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, reason: "url_too_long" };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "unsupported_protocol" };
  }

  if (url.username || url.password) {
    return { ok: false, reason: "credentials_in_url" };
  }

  // Shop pages live on the default ports; odd ports are how internal services get reached.
  if (!allowedPorts.has(url.port)) {
    return { ok: false, reason: "blocked_port" };
  }

  // "localhost." (trailing dot) resolves exactly like "localhost".
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const bareHost = stripBrackets(hostname);

  if (isIP(bareHost)) {
    return isBlockedIp(bareHost) ? { ok: false, reason: "blocked_ip" } : { ok: true, url };
  }

  if (
    blockedHostnames.has(hostname) ||
    blockedHostSuffixes.some((suffix) => hostname.endsWith(suffix)) ||
    !hostname.includes(".")
  ) {
    return { ok: false, reason: "blocked_hostname" };
  }

  return { ok: true, url };
}

export function isBlockedIp(value: string) {
  const ip = stripBrackets(value);
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return false;
}

function stripBrackets(value: string) {
  return value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
}

function isBlockedIpv4(ip: string) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // documentation
    (a === 192 && b === 88 && c === 99) || // 6to4 relay
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) || // documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

function ipv4FromHextets(high: number, low: number) {
  return isBlockedIpv4(`${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`);
}

function parseIpv6(raw: string): number[] | null {
  let ip = raw.split("%")[0];
  const v4Tail = ip.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4Tail) {
    const octets = v4Tail.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    const head = ip.slice(0, ip.length - v4Tail[0].length);
    ip = `${head}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }

  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;

  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  const numbers = groups.map((group) => (/^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : Number.NaN));
  return numbers.length === 8 && !numbers.some(Number.isNaN) ? numbers : null;
}

function isBlockedIpv6(ip: string) {
  const parsed = parseIpv6(ip);
  if (!parsed) return true; // unparseable: fail closed
  const [a, b, c, d, e, f, g, h] = parsed;

  if (a === 0 && b === 0 && c === 0 && d === 0 && e === 0) {
    if (f === 0xffff) return ipv4FromHextets(g, h); // IPv4-mapped, e.g. ::ffff:127.0.0.1
    if (f === 0) return true; // ::, ::1 and deprecated IPv4-compatible addresses
  }
  if (a === 0x64 && b === 0xff9b) {
    // NAT64: the embedded IPv4 decides; the local-use /48 is always blocked.
    return c === 0 && d === 0 && e === 0 && f === 0 ? ipv4FromHextets(g, h) : true;
  }
  if ((a & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if ((a & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((a & 0xffc0) === 0xfec0) return true; // deprecated site-local
  if ((a & 0xff00) === 0xff00) return true; // multicast
  if (a === 0x2001 && (b === 0 || b === 0x0db8)) return true; // Teredo, documentation
  if (a === 0x2002) return ipv4FromHextets(b, c); // 6to4 embeds an IPv4 address
  if (a === 0x0100 && b === 0 && c === 0 && d === 0) return true; // discard-only
  return false;
}

export function urlSafetyMessage(reason: UrlSafetyReason) {
  if (reason === "invalid_url") return "올바른 URL 형식이 아닙니다.";
  if (reason === "url_too_long") return "URL이 너무 깁니다. 상품 페이지의 기본 주소를 붙여 넣어 주세요.";
  if (reason === "unsupported_protocol") return "http 또는 https 주소만 분석할 수 있습니다.";
  if (reason === "credentials_in_url") return "아이디나 비밀번호가 들어 있는 주소는 분석할 수 없습니다.";
  if (reason === "blocked_port") return "보안상 기본 포트(80, 443)가 아닌 주소는 자동 분석할 수 없습니다.";
  if (reason === "blocked_hostname") return "보안상 이 호스트는 자동 분석할 수 없습니다.";
  return "보안상 사설망 또는 로컬 네트워크 주소는 자동 분석할 수 없습니다.";
}
