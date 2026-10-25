import { describe, expect, it } from "vitest";
import { StatbankClient } from "../src/statbank/client.js";
import { RateLimiter } from "../src/statbank/infra.js";
import { GetDataInput, GetDataOutput, GetTableInfoOutput, SearchTablesOutput, StatbankTools, ToolInputError } from "../src/tools.js";
import { mockFetch, replayTools } from "./helpers.js";

const dataInput = (i: unknown) => GetDataInput.parse(i);

describe("search_tables (fixtures)", () => {
  it("finds BIL51 for new car registrations by fuel type", async () => {
    const out = SearchTablesOutput.parse(
      await replayTools().searchTables({ query: "nyregistrerede personbiler drivmiddel", limit: 5, include_inactive: false, lang: "da" }),
    );
    expect(out.results.map((r) => r.id)).toContain("BIL51");
    expect(out.total_tables_indexed).toBeGreaterThan(2000);
  });
});

describe("get_table_info (fixtures)", () => {
  it("trims long value lists and keeps the newest periods", async () => {
    const out = GetTableInfoOutput.parse(await replayTools().getTableInfo({ table_id: "BIL51", max_values: 25, lang: "da" }));
    const tid = out.variables.find((v) => v.is_time)!;
    expect(tid.value_count).toBeGreaterThan(150);
    expect(tid.values).toHaveLength(25);
    expect(tid.truncated).toBe(true);
    expect(tid.values[0]!.code).toBe("2011M01");
    expect(tid.values.at(-1)!.code).toBe("2026M09");
    expect(out.variables.find((v) => v.code === "DRIV")!.values).toContainEqual({ code: "20225", label: "El" });
    expect(JSON.stringify(out)).not.toMatch(/contacts|@dst\.dk/);
  });

  it("finds codes with value_search", async () => {
    const out = await replayTools().getTableInfo({ table_id: "BIL51", max_values: 25, lang: "da", value_search: { variable: "drIV", query: "benzin" } });
    expect(out.value_search_results?.map((v) => v.code)).toEqual(expect.arrayContaining(["20205", "20233"]));
  });
});

describe("get_data (fixtures)", () => {
  it("returns verified monthly EV registrations for 2025", async () => {
    const out = GetDataOutput.parse(
      await replayTools().getData(dataInput({ table_id: "BIL51", variables: [{ code: "DRIV", values: ["20225"] }, { code: "Tid", values: ["2025M*"] }] })),
    );
    expect(out.columns).toEqual(["tid", "value"]);
    expect(out.rows.map((r) => r[1])).toEqual([6953, 7718, 9828, 9561, 10939, 12113, 9272, 8979, 12986, 11392, 11721, 14948]);
    expect(out.fixed).toEqual([{ code: "DRIV", label: "drivmiddel", value: { code: "20225", label: "El" } }]);
    expect(out.eliminated.map((e) => e.code)).toEqual(["EJER"]);
    expect(out.summary.sum).toBe(126410);
    expect(out.source.api_query.variables.find((v) => v.code === "Tid")!.values).toHaveLength(12);
  });

  it("labels dimension values and keeps the full result for charts", async () => {
    const tools = replayTools();
    const out = await tools.getData(dataInput({ table_id: "BIL51", variables: [{ code: "DRIV", values: ["20225", "20205"] }, { code: "Tid", values: ["2026M09"] }] }));
    expect(out.rows).toEqual([
      ["Benzin", 1665],
      ["El", 17778],
    ]);
    expect(tools.getResult(out.result_id)?.rows).toHaveLength(2);
  });

  it("defaults omitted time to the latest period (da and en quarter codes)", async () => {
    const da = await replayTools().getData(dataInput({ table_id: "FOLK1A", variables: [{ code: "Tid", values: ["2026K3"] }] }));
    expect(da.rows).toEqual([[6031699]]);
    const en = await replayTools().getData(dataInput({ table_id: "FOLK1A", lang: "en", variables: [{ code: "Tid", values: ["2026Q3"] }] }));
    expect(en.rows).toEqual([[6031699]]);
  });

  it("truncates rows but reports the full count", async () => {
    const out = await replayTools().getData(dataInput({ table_id: "BIL51", max_rows: 3, variables: [{ code: "DRIV", values: ["20225"] }, { code: "Tid", values: ["2025M*"] }] }));
    expect(out.rows).toHaveLength(3);
    expect(out).toMatchObject({ row_count: 12, truncated: true });
  });

  it("rejects bad codes and oversized selections before calling the API", async () => {
    const tools = replayTools();
    await expect(tools.getData(dataInput({ table_id: "BIL51", variables: [{ code: "DRIV", values: ["diesl"] }] }))).rejects.toBeInstanceOf(ToolInputError);
    await expect(tools.getData(dataInput({ table_id: "BIL51", variables: [{ code: "FOO", values: ["1"] }] }))).rejects.toThrow(/has no variable "FOO"/);
    await expect(
      tools.getData(dataInput({ table_id: "FOLK1A", variables: [{ code: "OMRÅDE", values: ["*"] }, { code: "ALDER", values: ["*"] }, { code: "Tid", values: ["*"] }] })),
    ).rejects.toThrow(/cells \(limit 20,000\)/);
  });

  it("turns an unknown table into a ToolInputError", async () => {
    await expect(replayTools().getTableInfo({ table_id: "NOPE999", max_values: 25, lang: "da" })).rejects.toThrow(/Table "NOPE999" not found/);
  });

  it("requires non-eliminable variables", async () => {
    const info = {
      id: "T1",
      text: "Test",
      variables: [
        { id: "ENHED", text: "enhed", elimination: false, time: false, values: [{ id: "100", text: "Indeks" }] },
        { id: "Tid", text: "tid", elimination: false, time: true, values: [{ id: "2025", text: "2025" }] },
      ],
    };
    const m = mockFetch([{ status: 200, body: info }]);
    const tools = new StatbankTools(new StatbankClient({ fetch: m.fetch, limiter: new RateLimiter(1, 0) }));
    await expect(tools.getData(dataInput({ table_id: "T1" }))).rejects.toThrow(/ENHED \(enhed\) cannot be omitted/);
  });
});
