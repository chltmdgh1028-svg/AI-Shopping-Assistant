import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { isBlockedIp, urlSafetyMessage, validateHttpUrl, type UrlSafetyResult } from "@/lib/urlSafety";

export const FETCH_LIMITS = {
  maxBytes: 1_500_000,
  // One product detail image. A long stitched JPEG is a few MB at most; anything bigger is not read.
  maxImageBytes: 4_000_000,
  timeoutMs: 8000,
  maxRedirects: 4,
};

export type SafeFetchResult =
  | { ok: true; html: string; finalUrl: string }
  | {
      ok: false;
      code: "invalid_url" | "blocked_url" | "fetch_failed" | "unsupported_content" | "too_large";
      message: string;
    };

type FetchFailure = Extract<SafeFetchResult, { ok: false }>;

export type SafeFetchDeps = {
  validateUrl: (rawUrl: string) => UrlSafetyResult;
  isBlockedAddress: (address: string) => boolean;
  limits: typeof FETCH_LIMITS;
};

const defaultDeps: SafeFetchDeps = {
  validateUrl: validateHttpUrl,
  isBlockedAddress: isBlockedIp,
  limits: FETCH_LIMITS,
};

type FetchMode = "html" | "image" | "json";

type RequestInit = { method: "POST"; body: string };

type HopResult =
  | { kind: "redirect"; location: string }
  | { kind: "page"; html: string }
  | { kind: "image"; bytes: Buffer; mimeType: string }
  | FetchFailure;

/**
 * Fetches a public HTML page. Every hop (including redirects) is re-validated, and the IP the socket
 * connects to is checked inside the DNS lookup itself, so a hostname cannot pass validation and then
 * resolve to a private address when the connection is made (DNS rebinding).
 */
export async function fetchPublicHtml(rawUrl: string, overrides: Partial<SafeFetchDeps> = {}): Promise<SafeFetchResult> {
  const result = await followRedirects(rawUrl, { ...defaultDeps, ...overrides }, "html");
  if ("ok" in result) return result;
  return result.kind === "page" ? { ok: true, html: result.html, finalUrl: result.finalUrl } : failure("unsupported_content", "HTML 상품 페이지가 아닌 응답은 분석할 수 없습니다.");
}

export type ImageFetchResult = { ok: true; bytes: Buffer; mimeType: string; finalUrl: string } | FetchFailure;

/**
 * Fetches one public image (JPEG, PNG or WebP) for reading by a vision model. Same guards as a page: every hop is
 * validated, the connected IP is checked inside DNS lookup, and the decoded size is capped.
 */
export async function fetchPublicImage(rawUrl: string, overrides: Partial<SafeFetchDeps> = {}): Promise<ImageFetchResult> {
  const result = await followRedirects(rawUrl, { ...defaultDeps, ...overrides }, "image");
  if ("ok" in result) return result;
  return result.kind === "image" ? { ok: true, bytes: result.bytes, mimeType: result.mimeType, finalUrl: result.finalUrl } : failure("unsupported_content", "이미지가 아닌 응답은 읽을 수 없습니다.");
}

export type JsonFetchResult = { ok: true; data: unknown } | FetchFailure;

/**
 * POSTs a JSON body to a public API and returns the parsed JSON. No redirects are followed (an API that redirects is
 * not the API we meant to call), and the destination is validated and DNS-guarded like any other fetch.
 */
export async function fetchPublicJson(rawUrl: string, body: unknown, overrides: Partial<SafeFetchDeps> = {}): Promise<JsonFetchResult> {
  const deps = { ...defaultDeps, ...overrides };
  const safety = deps.validateUrl(rawUrl);
  if (!safety.ok) {
    return {
      ok: false,
      code: safety.reason === "invalid_url" || safety.reason === "url_too_long" ? "invalid_url" : "blocked_url",
      message: urlSafetyMessage(safety.reason),
    };
  }
  const result = await requestOnce(safety.url, deps, deps.limits.timeoutMs, "json", { method: "POST", body: JSON.stringify(body) });
  if ("ok" in result) return result;
  if (result.kind !== "page") return failure("fetch_failed", "상세 정보 API가 예상과 다른 응답을 보냈어요.");
  try {
    return { ok: true, data: JSON.parse(result.html) as unknown };
  } catch {
    return failure("fetch_failed", "상세 정보 API 응답을 읽지 못했어요.");
  }
}

type Followed = (Extract<HopResult, { kind: "page" }> & { finalUrl: string }) | (Extract<HopResult, { kind: "image" }> & { finalUrl: string }) | FetchFailure;

async function followRedirects(rawUrl: string, deps: SafeFetchDeps, mode: FetchMode): Promise<Followed> {
  const deadline = Date.now() + deps.limits.timeoutMs;
  let current = rawUrl;

  for (let hop = 0; hop <= deps.limits.maxRedirects; hop += 1) {
    const safety = deps.validateUrl(current);
    if (!safety.ok) {
      return {
        ok: false,
        code: safety.reason === "invalid_url" || safety.reason === "url_too_long" ? "invalid_url" : "blocked_url",
        message: urlSafetyMessage(safety.reason),
      };
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) return failure("fetch_failed", "쇼핑몰 페이지 응답이 너무 오래 걸려 중단했습니다.");

    const result = await requestOnce(safety.url, deps, remaining, mode);
    if ("ok" in result) return result;
    if (result.kind === "redirect") {
      try {
        current = new URL(result.location, safety.url).toString();
      } catch {
        return failure("fetch_failed", "쇼핑몰 페이지가 올바르지 않은 이동 주소를 보냈습니다.");
      }
      continue;
    }
    return { ...result, finalUrl: safety.url.toString() };
  }

  return failure("fetch_failed", "쇼핑몰 페이지가 너무 많이 이동해서 중단했습니다.");
}

export type HopOutcome =
  | { kind: "redirect"; location: string }
  | { kind: "page"; html: string; finalUrl: string }
  | FetchFailure;

/**
 * One request, no redirect following. Share-link resolution reads the redirect target itself, because it can be a
 * custom app scheme (zigzag://...) that must never be fetched, or an address whose query string holds the real
 * destination. The URL is validated and the connection guarded exactly as in fetchPublicHtml.
 */
export async function fetchHop(rawUrl: string, timeoutMs: number, overrides: Partial<SafeFetchDeps> = {}): Promise<HopOutcome> {
  const deps = { ...defaultDeps, ...overrides };
  const safety = deps.validateUrl(rawUrl);
  if (!safety.ok) {
    return {
      ok: false,
      code: safety.reason === "invalid_url" || safety.reason === "url_too_long" ? "invalid_url" : "blocked_url",
      message: urlSafetyMessage(safety.reason),
    };
  }
  const result = await requestOnce(safety.url, deps, timeoutMs);
  if ("ok" in result || result.kind === "redirect") return result;
  return result.kind === "page" ? { kind: "page", html: result.html, finalUrl: safety.url.toString() } : failure("unsupported_content", "HTML 상품 페이지가 아닌 응답은 분석할 수 없습니다.");
}

function failure(code: FetchFailure["code"], message: string): FetchFailure {
  return { ok: false, code, message };
}

function requestOnce(url: URL, deps: SafeFetchDeps, timeoutMs: number, mode: FetchMode = "html", init?: RequestInit): Promise<HopResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: HopResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    // IP literals skip DNS entirely, so they are checked here instead of in the lookup hook.
    if (isIP(hostname) && deps.isBlockedAddress(hostname)) {
      return resolve(failure("blocked_url", urlSafetyMessage("blocked_ip")));
    }

    const lookup: LookupFunction = (name, options, callback) => {
      dns.lookup(name, { all: true, verbatim: true }, (error, addresses) => {
        if (error) return callback(error, "", 4);
        if (addresses.length === 0 || addresses.some((entry) => deps.isBlockedAddress(entry.address))) {
          return callback(Object.assign(new Error("blocked address"), { code: "ESSRF" }), "", 4);
        }
        if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, addresses);
        return callback(null, addresses[0].address, addresses[0].family);
      });
    };

    const transport = url.protocol === "https:" ? https : http;
    const request = transport.request(
      url,
      {
        method: init?.method ?? "GET",
        lookup,
        agent: false,
        headers: {
          accept: mode === "image" ? "image/jpeg,image/png,image/webp" : mode === "json" ? "application/json" : "text/html,application/xhtml+xml",
          ...(init ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(init.body)) } : {}),
          // Images are already compressed; asking for identity keeps the size cap meaningful.
          "accept-encoding": mode === "image" ? "identity" : "gzip, deflate, br",
          "accept-language": "ko,en;q=0.8",
          "user-agent": "ShoppingAssistantBot/0.3 (+https://github.com/chltmdgh1028-svg/AI-Shopping-Assistant)",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;

        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          return finish({ kind: "redirect", location: String(response.headers.location) });
        }
        if (status < 200 || status >= 300) {
          response.resume();
          return finish(failure("fetch_failed", `상품 페이지를 읽지 못했습니다. HTTP ${status}`));
        }

        const contentType = String(response.headers["content-type"] ?? "");
        const accepted = mode === "image" ? /^image\/(jpeg|jpg|png|webp)\b/i : mode === "json" ? /application\/json/i : /text\/html|application\/xhtml/i;
        if (!accepted.test(contentType)) {
          response.resume();
          return finish(failure("unsupported_content", mode === "image" ? "읽을 수 있는 이미지 형식이 아니에요." : mode === "json" ? "JSON이 아닌 응답은 읽을 수 없어요." : "HTML 상품 페이지가 아닌 응답은 분석할 수 없습니다."));
        }

        const cap = mode === "image" ? deps.limits.maxImageBytes : deps.limits.maxBytes;
        if (Number(response.headers["content-length"] ?? "0") > cap) {
          response.resume();
          return finish(failure("too_large", "페이지가 너무 커서 자동 분석을 중단했습니다."));
        }

        if (mode === "image") {
          readImage(response, cap, contentType).then(finish, () => finish(failure("fetch_failed", "이미지를 읽는 중 문제가 발생했습니다.")));
          return;
        }

        readBody(decodeStream(response), deps.limits.maxBytes, contentType).then(finish, () =>
          finish(failure("fetch_failed", "쇼핑몰 페이지를 읽는 중 문제가 발생했습니다.")),
        );
      },
    );

    const timer = setTimeout(() => {
      request.destroy();
      finish(failure("fetch_failed", "쇼핑몰 페이지 응답이 너무 오래 걸려 중단했습니다."));
    }, timeoutMs);

    request.on("error", (error: NodeJS.ErrnoException) => {
      finish(
        error.code === "ESSRF"
          ? failure("blocked_url", urlSafetyMessage("blocked_ip"))
          : failure("fetch_failed", "쇼핑몰 페이지를 읽는 중 문제가 발생했습니다."),
      );
    });
    request.end(init?.body);
  });
}

function decodeStream(response: http.IncomingMessage): Readable {
  const encoding = String(response.headers["content-encoding"] ?? "").toLowerCase();
  if (encoding === "gzip" || encoding === "x-gzip") return response.pipe(createGunzip());
  if (encoding === "deflate") return response.pipe(createInflate());
  if (encoding === "br") return response.pipe(createBrotliDecompress());
  return response;
}

class TooLargeError extends Error {}

async function readImage(stream: Readable, maxBytes: number, contentType: string): Promise<HopResult> {
  const chunks: Buffer[] = [];
  let received = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.length;
      if (received > maxBytes) throw new TooLargeError();
      chunks.push(buffer);
    }
  } catch (error) {
    stream.destroy();
    if (error instanceof TooLargeError) return failure("too_large", "이미지가 너무 커서 읽지 않았어요.");
    throw error;
  }
  const mimeType = contentType.split(";")[0].trim().toLowerCase().replace("image/jpg", "image/jpeg");
  return { kind: "image", bytes: Buffer.concat(chunks), mimeType };
}

// The cap applies to the decoded bytes, so a small compressed bomb cannot expand past it.
async function readBody(stream: Readable, maxBytes: number, contentType: string): Promise<HopResult> {
  const chunks: Buffer[] = [];
  let received = 0;

  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      received += buffer.length;
      if (received > maxBytes) throw new TooLargeError();
      chunks.push(buffer);
    }
  } catch (error) {
    stream.destroy();
    if (error instanceof TooLargeError) return failure("too_large", "페이지가 너무 커서 자동 분석을 중단했습니다.");
    throw error;
  }

  const bytes = Buffer.concat(chunks);
  return { kind: "page", html: decodeHtmlBytes(bytes, contentType) };
}

// Many Korean shops still serve EUC-KR; decoding it as UTF-8 would turn every Korean label into noise.
function decodeHtmlBytes(bytes: Buffer, contentType: string) {
  const headerCharset = contentType.match(/charset=["']?([\w-]+)/i)?.[1];
  const sniffed = bytes.subarray(0, 2048).toString("latin1").match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  const charset = (headerCharset ?? sniffed ?? "utf-8").toLowerCase();

  try {
    return new TextDecoder(charset === "ks_c_5601-1987" ? "euc-kr" : charset).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
