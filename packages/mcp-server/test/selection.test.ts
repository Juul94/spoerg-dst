import { describe, expect, it } from "vitest";
import { resolveValues, SelectionError } from "../src/selection.js";
import type { Variable } from "../src/statbank/schemas.js";

const time: Variable = {
  id: "Tid",
  text: "tid",
  elimination: false,
  time: true,
  values: ["2024K3", "2024K4", "2025K1", "2025K2", "2025K3"].map((id) => ({ id, text: id })),
};
const driv: Variable = {
  id: "DRIV",
  text: "drivmiddel",
  elimination: true,
  time: false,
  values: [
    { id: "20200", text: "Drivmidler i alt" },
    { id: "20205", text: "Benzin" },
    { id: "20225", text: "El" },
    { id: "20233", text: "Benzinhybrid" },
  ],
};
const ids = (v: { id: string }[]) => v.map((x) => x.id);

describe("resolveValues", () => {
  it("handles *, (n), ranges and wildcards", () => {
    expect(ids(resolveValues(time, ["*"]))).toHaveLength(5);
    expect(ids(resolveValues(time, ["(2)"]))).toEqual(["2025K2", "2025K3"]);
    expect(ids(resolveValues(time, [">=2024K4<=2025K2"]))).toEqual(["2024K4", "2025K1", "2025K2"]);
    expect(ids(resolveValues(time, [">=2025K2"]))).toEqual(["2025K2", "2025K3"]);
    expect(ids(resolveValues(time, ["2025*"]))).toEqual(["2025K1", "2025K2", "2025K3"]);
  });

  it("accepts labels, case-insensitive codes and Q/K quarter spelling", () => {
    expect(ids(resolveValues(driv, ["el", "BENZIN"]))).toEqual(["20205", "20225"]);
    expect(ids(resolveValues(time, ["2025Q3"]))).toEqual(["2025K3"]);
  });

  it("keeps metadata order and de-duplicates", () => {
    expect(ids(resolveValues(driv, ["20225", "20205", "20225"]))).toEqual(["20205", "20225"]);
  });

  it("rejects unknown values with suggestions", () => {
    expect(() => resolveValues(driv, ["benz"])).toThrow(SelectionError);
    expect(() => resolveValues(driv, ["benz"])).toThrow(/Did you mean: 20205 \(Benzin\), 20233 \(Benzinhybrid\)/);
    expect(() => resolveValues(time, ["2030K1"])).toThrow(/Available periods: 2024K3 … 2025K3/);
  });
});
