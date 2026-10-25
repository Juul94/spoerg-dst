import { describe, expect, it } from "vitest";
import { evaluate, loadDataset, parseRef, withinTolerance } from "../src/dataset.js";

describe("dataset", async () => {
  const cases = await loadDataset();

  it("has 25–40 cases covering every question type", () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
    expect(cases.length).toBeLessThanOrEqual(40);
    const types = new Set(cases.map((c) => c.type));
    expect([...types].sort()).toEqual(["ambiguous", "calculation", "lookup", "no_data", "time_comparison"]);
    expect(cases.filter((c) => c.expect === "not_found").length).toBeGreaterThanOrEqual(4);
    expect(cases.some((c) => /\b(the|what|how)\b/i.test(c.question))).toBe(true);
  });

  it("stores verified values, and every expected answer follows from its refs", () => {
    for (const c of cases) {
      const vars = Object.fromEntries(Object.entries(c.refs).map(([k, r]) => [k, r.value]));
      expect(Object.values(vars), c.id).not.toContain(null);
      for (const a of c.answers) {
        expect(a.value, `${c.id} ${a.label}`).not.toBeNull();
        expect(evaluate(a.expr, vars as Record<string, number>)).toBeCloseTo(a.value!, 3);
      }
    }
  });

  it("has a small CI subset including a refusal case", () => {
    const ci = cases.filter((c) => c.tags.includes("ci"));
    expect(ci.length).toBeGreaterThanOrEqual(4);
    expect(ci.length).toBeLessThanOrEqual(8);
    expect(ci.some((c) => c.expect === "not_found")).toBe(true);
  });
});

describe("parseRef", () => {
  it("parses table, variables and the sum prefix", () => {
    expect(parseRef("sum BIL51 DRIV=20225,20205 Tid=2025M*")).toEqual({
      sum: true,
      table: "BIL51",
      variables: [
        { code: "DRIV", values: ["20225", "20205"] },
        { code: "Tid", values: ["2025M*"] },
      ],
    });
    expect(() => parseRef("BIL51 DRIV")).toThrow(/Bad variable/);
  });
});

describe("evaluate", () => {
  it("respects precedence and parentheses", () => {
    expect(evaluate("(b - a) / a * 100", { a: 50, b: 60 })).toBeCloseTo(20);
    expect(evaluate("a + b * 2", { a: 1, b: 2 })).toBe(5);
    expect(evaluate("-a + 3", { a: 1 })).toBe(2);
    expect(() => evaluate("a +", { a: 1 })).toThrow();
    expect(() => evaluate("x", {})).toThrow(/Unknown name/);
  });
});

describe("withinTolerance", () => {
  it("uses 0.5% relative by default and tol_abs when set", () => {
    const base = { label: "x", expr: "a" };
    expect(withinTolerance(1004, { ...base, value: 1000 })).toBe(true);
    expect(withinTolerance(1006, { ...base, value: 1000 })).toBe(false);
    expect(withinTolerance(2.25, { ...base, value: 2.2, tol_abs: 0.05 })).toBe(true);
    expect(withinTolerance(2.3, { ...base, value: 2.2, tol_abs: 0.05 })).toBe(false);
  });
});
