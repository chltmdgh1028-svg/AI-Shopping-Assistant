import { describe, expect, it } from "vitest";
import { clientKeyFromHeaders, createInflightDeduper, createRateLimiter } from "@/lib/requestGuard";

describe("createRateLimiter", () => {
  it("allows up to the limit inside the window, then reports when to retry", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 10_000 });
    expect(limiter.check("a", 0)).toEqual({ allowed: true });
    expect(limiter.check("a", 1000)).toEqual({ allowed: true });
    expect(limiter.check("a", 2000)).toEqual({ allowed: false, retryAfterSeconds: 8 });
  });

  it("tracks clients independently and recovers after the window", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("b", 0).allowed).toBe(true);
    expect(limiter.check("a", 500).allowed).toBe(false);
    expect(limiter.check("a", 1500).allowed).toBe(true);
  });
});

describe("createInflightDeduper", () => {
  it("shares one run between concurrent identical requests and clears afterwards", async () => {
    const deduper = createInflightDeduper<number>();
    let runs = 0;
    const task = async () => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return runs;
    };

    const [first, second] = await Promise.all([deduper.run("u", task), deduper.run("u", task)]);
    expect(first).toBe(second);
    expect(runs).toBe(1);

    await deduper.run("u", task);
    expect(runs).toBe(2);
  });
});

describe("clientKeyFromHeaders", () => {
  it("prefers x-real-ip, then the first forwarded address", () => {
    expect(clientKeyFromHeaders(new Headers({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe("1.2.3.4");
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": "9.9.9.9, 8.8.8.8" }))).toBe("9.9.9.9");
    expect(clientKeyFromHeaders(new Headers())).toBe("unknown");
  });
});
