// Best-effort abuse boundaries for the public analyze endpoint.
//
// These live in process memory. On serverless platforms (Vercel) every instance has its own copy and
// instances come and go, so this limits bursts from one client on one warm instance. It is NOT a
// security control: a determined caller can bypass it. Real protection needs a shared store
// (Vercel WAF rate limiting, Upstash, etc.), see README "Known limitations".

export type RateLimiter = {
  check(key: string, now?: number): { allowed: true } | { allowed: false; retryAfterSeconds: number };
};

export function createRateLimiter({ limit, windowMs, maxKeys = 5000 }: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    check(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000)) };
      }

      recent.push(now);
      hits.set(key, recent);

      if (hits.size > maxKeys) {
        for (const [storedKey, times] of hits) {
          if (times.every((time) => now - time >= windowMs)) hits.delete(storedKey);
        }
      }
      return { allowed: true };
    },
  };
}

/** Shares one in-flight promise per key so repeated identical requests do not fan out to Gemini. */
export function createInflightDeduper<T>() {
  const inflight = new Map<string, Promise<T>>();

  return {
    run(key: string, task: () => Promise<T>): Promise<T> {
      const existing = inflight.get(key);
      if (existing) return existing;
      const promise = task().finally(() => inflight.delete(key));
      inflight.set(key, promise);
      return promise;
    },
  };
}

export function clientKeyFromHeaders(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return headers.get("x-real-ip")?.trim() || forwarded || "unknown";
}
