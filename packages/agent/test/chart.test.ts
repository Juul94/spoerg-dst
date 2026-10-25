import type { StoredResult } from "statbank-mcp";
import { describe, expect, it } from "vitest";
import { buildChart } from "../src/chart.js";
import { costUsd } from "../src/pricing.js";
import { toAnthropicTool } from "../src/agent.js";
import { SubmitAnswerInput } from "../src/answer.js";

const base: Omit<StoredResult, "columns" | "rows" | "timeColumn"> = {
  id: "r1",
  tableId: "BIL51",
  title: "Nyregistrerede personbiler",
  unit: "antal",
  fixed: [],
  source: { table_id: "BIL51", statbank_url: "", api_query: { table: "BIL51", lang: "da", variables: [] } },
};

describe("buildChart", () => {
  it("pivots a second dimension into series with time on the x axis", () => {
    const c = buildChart(
      {
        ...base,
        columns: ["drivmiddel", "tid", "value"],
        timeColumn: 1,
        rows: [
          ["El", "2026M08", 1],
          ["El", "2026M09", 2],
          ["Benzin", "2026M08", 3],
          ["Benzin", "2026M09", 4],
        ],
      },
      "line",
    );
    expect(c.series).toEqual(["El", "Benzin"]);
    expect(c.xLabel).toBe("tid");
    expect(c.data).toEqual([
      { x: "2026M08", El: 1, Benzin: 3 },
      { x: "2026M09", El: 2, Benzin: 4 },
    ]);
  });

  it("handles a single value", () => {
    const c = buildChart({ ...base, columns: ["value"], timeColumn: null, rows: [[42]] }, "line");
    expect(c).toMatchObject({ type: "bar", series: ["value"], data: [{ value: 42 }] });
  });
});

describe("costUsd", () => {
  it("prices cache reads and writes separately", () => {
    expect(costUsd("claude-sonnet-5-5", { input_tokens: 1e6, output_tokens: 1e6, cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6 })).toBeCloseTo(2 + 10 + 0.2 + 2.5);
    expect(costUsd("unknown", { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBeNull();
  });
});

describe("toAnthropicTool", () => {
  it("emits an input schema where defaulted fields are optional", () => {
    const t = toAnthropicTool("submit_answer", "d", SubmitAnswerInput);
    expect(t.input_schema.type).toBe("object");
    expect(t.input_schema.required).toEqual(["status", "answer"]);
    expect(t.input_schema).not.toHaveProperty("$schema");
  });
});
