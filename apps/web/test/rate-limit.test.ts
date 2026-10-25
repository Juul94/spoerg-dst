import { describe, expect, it } from "vitest";
import { WindowLimiter } from "../lib/rate-limit";

describe("WindowLimiter", () => {
  it("allows up to the limit per window, then reports the wait", () => {
    let t = 0;
    const l = new WindowLimiter(2, 1000, () => t);
    expect(l.take("a")).toBe(0);
    expect(l.take("a")).toBe(0);
    t = 400;
    expect(l.take("a")).toBe(600);
    expect(l.take("b")).toBe(0);
    t = 1000;
    expect(l.take("a")).toBe(0);
  });
});
