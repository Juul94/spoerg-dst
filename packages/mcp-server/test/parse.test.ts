import { describe, expect, it } from "vitest";
import { parseCsv, parseNumber } from "../src/statbank/client.js";

describe("parseCsv", () => {
  it("parses BOM, header and Danish decimal comma", () => {
    const rows = parseCsv("﻿VAREGR;ENHED;TID;INDHOLD\r\n000000;100;2025M12;121,2\r\n000000;200;2025M12;-0,4\r\n", "da");
    expect(rows).toEqual([
      { keys: { VAREGR: "000000", ENHED: "100", TID: "2025M12" }, value: 121.2 },
      { keys: { VAREGR: "000000", ENHED: "200", TID: "2025M12" }, value: -0.4 },
    ]);
  });

  it("rejects an unexpected header", () => {
    expect(() => parseCsv("A;B\n1;2", "da")).toThrow(/Unexpected CSV header/);
  });
});

describe("parseNumber", () => {
  it.each([
    ["13876", "da", 13876],
    ["1.234,5", "da", 1234.5],
    ["1,234.5", "en", 1234.5],
    ["..", "da", null],
    ["-", "en", null],
    ["", "da", null],
  ] as const)("%s (%s) gives %s", (cell, lang, expected) => {
    expect(parseNumber(cell, lang)).toBe(expected);
  });
});
