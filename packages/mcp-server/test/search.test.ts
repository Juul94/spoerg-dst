import { describe, expect, it } from "vitest";
import { stem, TableIndex } from "../src/search.js";
import { StatbankClient } from "../src/statbank/client.js";
import { fixturesDir } from "./helpers.js";

describe("stem", () => {
  it("strips common Danish and English suffixes but keeps short words", () => {
    expect(stem("befolkningen")).toBe("befolkning");
    expect(stem("overnatninger")).toBe("overnatning");
    expect(stem("deaths")).toBe("death");
    expect(stem("cars")).toBe("cars");
  });
});

describe("TableIndex ranking (recorded table list)", async () => {
  const client = new StatbankClient({ mode: "replay", fixturesDir });
  const index = new TableIndex(await client.tables("da"), await client.tables("en"));
  const top = (q: string) => index.search(q, { limit: 3 }).map((h) => h.id);

  it.each([
    ["befolkning", "FOLK1A"],
    ["elbiler", "BIL51"],
    ["dødsfald", "DOD"],
    ["inflation", "PRIS01"],
    ["arbejdsløshed", "AUS07"],
    ["huspriser", "EJ56"],
    ["GDP growth", "NAN1"],
  ])("%s -> %s in top 3", (q, id) => {
    expect(top(q)).toContain(id);
  });

  it("still finds niche tables named in the query", () => {
    expect(top("KM1")[0]).toBe("KM1");
    expect(top("folkekirkemedlemskab sogn")).toContain("KM1");
  });
});
