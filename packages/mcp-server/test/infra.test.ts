import { describe, expect, it, vi } from "vitest";
import { RateLimiter, TtlCache, sleep, stableStringify } from "../src/statbank/infra.js";

describe("TtlCache", () => {
  it("expires entries and evicts the oldest at capacity", () => {
    vi.useFakeTimers();
    const c = new TtlCache<number>(2);
    c.set("a", 1, 1000);
    c.set("b", 2, 1000);
    c.set("c", 3, 1000);
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    vi.advanceTimersByTime(1001);
    expect(c.get("b")).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("RateLimiter", () => {
  it("never exceeds max concurrency", async () => {
    const limiter = new RateLimiter(2, 0);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limiter.run(async () => {
          peak = Math.max(peak, ++active);
          await sleep(10);
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it("spaces request starts by the minimum interval", async () => {
    const limiter = new RateLimiter(10, 30);
    const starts: number[] = [];
    await Promise.all(Array.from({ length: 3 }, () => limiter.run(async () => void starts.push(Date.now()))));
    expect(starts[2]! - starts[0]!).toBeGreaterThanOrEqual(55);
  });
});

describe("stableStringify", () => {
  it("is independent of key order", () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }));
  });
});
