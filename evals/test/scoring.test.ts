import type { AgentResult } from "@spoerg-dst/agent";
import { describe, expect, it } from "vitest";
import { EvalCase } from "../src/dataset.js";
import { scoreCase, selectCases, summarize } from "../src/scoring.js";

const caseOf = (c: Record<string, unknown> & { id: string }) => EvalCase.parse({ question: "Hvor mange?", type: "lookup", expect: "answered", ...c });

const lookup = caseOf({
  id: "ev",
  tables: ["BIL51"],
  refs: { a: { q: "BIL51 DRIV=20225 Tid=2026M09", value: 17778 } },
  answers: [{ label: "El", expr: "a", value: 17778 }],
});
const ambiguous = caseOf({
  id: "cph",
  type: "ambiguous",
  match: "any",
  tables: ["FOLK1A"],
  answers: [
    { label: "Kommune", expr: "a", value: 670389 },
    { label: "Region", expr: "b", value: 1949336 },
  ],
  refs: { a: { q: "FOLK1A OMRÅDE=101", value: 670389 }, b: { q: "FOLK1A OMRÅDE=084", value: 1949336 } },
});
const noData = caseOf({ id: "cats", type: "no_data", expect: "not_found", tags: ["ci"] });

function result(over: Partial<AgentResult> & { tables?: string[]; cost?: number | null } = {}): AgentResult {
  const { tables = ["BIL51"], cost = 0.01, ...rest } = over;
  return {
    status: "answered",
    answer: "",
    values: [],
    chart: null,
    sources: tables.map((t) => ({ result_id: "r", table_id: t, title: "", statbank_url: "", api_query: { table: t, lang: "da", variables: [] } })),
    trace: {
      run_id: "x",
      question: "",
      model: "m",
      prompt_version: "v1",
      started_at: "",
      latency_ms: 1000,
      llm_calls: [],
      steps: [],
      tool_calls: 3,
      usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 5 },
      cost_usd: cost,
    },
    ...rest,
  };
}
const v = (value: number) => ({ label: "x", value, computed: false });

describe("scoreCase", () => {
  it("passes a correct, sourced answer within tolerance", () => {
    const s = scoreCase(lookup, result({ values: [v(17790)] }));
    expect(s).toMatchObject({ pass: true, value_ok: true, table_ok: true, answers_matched: 1, input_tokens: 155 });
  });

  it("fails on a wrong value or a wrong table", () => {
    expect(scoreCase(lookup, result({ values: [v(18000)] }))).toMatchObject({ pass: false, value_ok: false, table_ok: true });
    expect(scoreCase(lookup, result({ values: [v(17778)], tables: ["BIL10"] }))).toMatchObject({ pass: false, value_ok: true, table_ok: false });
  });

  it("accepts any interpretation for ambiguous cases and records stated assumptions", () => {
    const s = scoreCase(ambiguous, result({ values: [v(1949336)], tables: ["FOLK1A"], assumptions: "Region Hovedstaden" }));
    expect(s).toMatchObject({ pass: true, answers_matched: 1, assumption_stated: true });
  });

  it("scores refusals: not_found is correct for no-data cases and wrong otherwise", () => {
    expect(scoreCase(noData, result({ status: "not_found", tables: [] }))).toMatchObject({ pass: true, value_ok: null });
    expect(scoreCase(noData, result({ values: [v(1)] }))).toMatchObject({ pass: false });
    expect(scoreCase(lookup, result({ status: "not_found", tables: [] }))).toMatchObject({ pass: false, status_ok: false });
  });
});

describe("summarize", () => {
  it("aggregates accuracy, refusals and cost", () => {
    const s = summarize([
      scoreCase(lookup, result({ values: [v(17778)] })),
      scoreCase(lookup, result({ status: "not_found", tables: [] })),
      scoreCase(noData, result({ status: "not_found", tables: [] })),
      scoreCase(ambiguous, result({ values: [v(670389)], tables: ["FOLK1A"] })),
    ]);
    expect(s).toMatchObject({ cases: 4, pass_rate: 0.75, refusal_accuracy: 1, assumption_rate: 0, avg_tool_calls: 3 });
    expect(s.value_accuracy).toBeCloseTo(2 / 3);
    expect(s.false_refusal_rate).toBeCloseTo(1 / 3);
    expect(s.total_cost_usd).toBeCloseTo(0.04);
    expect(s.pass_rate_by_type).toEqual({ lookup: 0.5, no_data: 1, ambiguous: 1 });
  });

  it("reports unknown cost as null", () => {
    expect(summarize([scoreCase(lookup, result({ cost: null }))]).total_cost_usd).toBeNull();
  });
});

describe("selectCases", () => {
  it("selects by tag, type and id", () => {
    const all = [lookup, ambiguous, noData];
    expect(selectCases(all, "ci").map((c) => c.id)).toEqual(["cats"]);
    expect(selectCases(all, "type:ambiguous,ev").map((c) => c.id)).toEqual(["ev", "cph"]);
    expect(() => selectCases(all, "nope")).toThrow();
  });
});
