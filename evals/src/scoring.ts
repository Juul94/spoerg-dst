import type { AgentResult } from "@spoerg-dst/agent";
import { withinTolerance, type EvalCase, type QuestionType } from "./dataset.js";

export interface CaseScore {
  id: string;
  type: QuestionType;
  expect: EvalCase["expect"];
  status: AgentResult["status"];
  /** Expected status reached (answered vs not_found). */
  status_ok: boolean;
  answers_expected: number;
  answers_matched: number;
  /** All (or, for match "any", one) expected values found within tolerance. null for not_found cases. */
  value_ok: boolean | null;
  /** At least one cited source is an accepted table. null for not_found cases. */
  table_ok: boolean | null;
  assumption_stated: boolean;
  pass: boolean;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  latency_ms: number;
  tables_used: string[];
  failure: string | null;
}

export function scoreCase(c: EvalCase, r: AgentResult): CaseScore {
  const u = r.trace.usage;
  const tablesUsed = [...new Set(r.sources.map((s) => s.table_id))];
  const base = {
    id: c.id,
    type: c.type,
    expect: c.expect,
    status: r.status,
    status_ok: r.status === c.expect,
    answers_expected: c.answers.length,
    assumption_stated: Boolean(r.assumptions?.trim()),
    tool_calls: r.trace.tool_calls,
    input_tokens: u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens,
    output_tokens: u.output_tokens,
    cost_usd: r.trace.cost_usd,
    latency_ms: r.trace.latency_ms,
    tables_used: tablesUsed,
    failure: r.failure ? `${r.failure.reason}: ${r.failure.message}` : null,
  };
  if (c.expect === "not_found") {
    return { ...base, answers_matched: 0, value_ok: null, table_ok: null, pass: base.status_ok };
  }
  const got = r.status === "answered" ? r.values.map((v) => v.value) : [];
  const matched = c.answers.filter((a) => a.value !== null && got.some((g) => withinTolerance(g, { ...a, value: a.value! }))).length;
  const valueOk = c.match === "any" ? matched > 0 : matched === c.answers.length;
  const tableOk = tablesUsed.some((t) => c.tables.includes(t.toUpperCase()));
  return { ...base, answers_matched: matched, value_ok: valueOk, table_ok: tableOk, pass: base.status_ok && valueOk && tableOk };
}

export interface Summary {
  cases: number;
  pass_rate: number;
  /** Share of answerable cases with correct values. */
  value_accuracy: number | null;
  /** Share of answerable cases citing an accepted table. */
  table_accuracy: number | null;
  /** Share of no-data cases correctly answered with not_found. */
  refusal_accuracy: number | null;
  /** Share of answerable cases that were refused or failed. */
  false_refusal_rate: number | null;
  /** Share of ambiguous cases where the agent stated its interpretation. */
  assumption_rate: number | null;
  failures: number;
  avg_tool_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number | null;
  avg_cost_usd: number | null;
  avg_latency_ms: number;
  p95_latency_ms: number;
  pass_rate_by_type: Partial<Record<QuestionType, number>>;
}

const share = <T>(xs: T[], pred: (x: T) => boolean): number | null => (xs.length ? xs.filter(pred).length / xs.length : null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarize(scores: CaseScore[]): Summary {
  const answerable = scores.filter((s) => s.expect === "answered");
  const noData = scores.filter((s) => s.expect === "not_found");
  const costs = scores.map((s) => s.cost_usd);
  const totalCost = costs.some((c) => c === null) ? null : (costs as number[]).reduce((a, b) => a + b, 0);
  const latencies = scores.map((s) => s.latency_ms).sort((a, b) => a - b);
  const byType: Summary["pass_rate_by_type"] = {};
  for (const t of new Set(scores.map((s) => s.type))) byType[t] = share(scores.filter((s) => s.type === t), (s) => s.pass)!;
  return {
    cases: scores.length,
    pass_rate: share(scores, (s) => s.pass) ?? 0,
    value_accuracy: share(answerable, (s) => s.value_ok === true),
    table_accuracy: share(answerable, (s) => s.table_ok === true),
    refusal_accuracy: share(noData, (s) => s.status_ok),
    false_refusal_rate: share(answerable, (s) => s.status !== "answered"),
    assumption_rate: share(scores.filter((s) => s.type === "ambiguous"), (s) => s.assumption_stated),
    failures: scores.filter((s) => s.status === "failed").length,
    avg_tool_calls: mean(scores.map((s) => s.tool_calls)),
    total_input_tokens: scores.reduce((a, s) => a + s.input_tokens, 0),
    total_output_tokens: scores.reduce((a, s) => a + s.output_tokens, 0),
    total_cost_usd: totalCost,
    avg_cost_usd: totalCost === null || !scores.length ? null : totalCost / scores.length,
    avg_latency_ms: mean(latencies),
    p95_latency_ms: latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)] ?? 0,
    pass_rate_by_type: byType,
  };
}

/** Selects cases by comma-separated ids, tags ("ci") or types ("type:ambiguous"). */
export function selectCases(cases: EvalCase[], subset: string | undefined): EvalCase[] {
  if (!subset) return cases;
  const keys = subset.split(",").map((s) => s.trim());
  const picked = cases.filter((c) => keys.some((k) => k === c.id || c.tags.includes(k) || k === `type:${c.type}`));
  if (!picked.length) throw new Error(`Subset "${subset}" matched no cases`);
  return picked;
}
