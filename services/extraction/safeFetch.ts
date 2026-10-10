import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import type { Readable } from "node:stream";
import { isBlockedIp, urlSafetyMessage, validateHttpUrl, type UrlSafetyResult } from "@/lib/urlSafety";

export const FETCH_LIMITS = {
  maxBytes: 1_500_000,
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

type HopResult = { kind: "redirect"; location: string } | { kind: "page"; html: string } | FetchFailure;

/**
 * Fetches a public HTML page. Every hop (including redirects) is re-validated, and the IP the socket
 * connects to is checked inside the DNS lookup itself, so a hostname cannot pass validation and then
 * resolve to a private address when the connection is made (DNS rebinding).
 */
export async function fetchPublicHtml(rawUrl: string, overrides: Partial<SafeFetchDeps> = {}): Promise<SafeFetchResult> {
  const deps = { ...defaultDeps, ...overrides };
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

    const result = await requestOnce(safety.url, deps, remaining);
    if ("ok" in result) return result;
    if (result.kind === "redirect") {
      try {
        current = new URL(result.location, safety.url).toString();
      } catch {
        return failure("fetch_failed", "쇼핑몰 페이지가 올바르지 않은 이동 주소를 보냈습니다.");
      }
      continue;
    }
    return { ok: true, html: result.html, finalUrl: safety.url.toString() };
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
  if ("ok" in result) return result;
  return result.kind === "redirect" ? result : { kind: "page", html: result.html, finalUrl: safety.url.toString() };
}

function failure(code: FetchFailure["code"], message: string): FetchFailure {
  return { ok: false, code, message };
}

function requestOnce(url: URL, deps: SafeFetchDeps, timeoutMs: number): Promise<HopResult> {
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
        method: "GET",
        lookup,
        agent: false,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-encoding": "gzip, deflate, br",
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
        if (!/text\/html|application\/xhtml/i.test(contentType)) {
          response.resume();
          return finish(failure("unsupported_content", "HTML 상품 페이지가 아닌 응답은 분석할 수 없습니다."));
        }

        if (Number(response.headers["content-length"] ?? "0") > deps.limits.maxBytes) {
          response.resume();
          return finish(failure("too_large", "페이지가 너무 커서 자동 분석을 중단했습니다."));
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
    request.end();
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
