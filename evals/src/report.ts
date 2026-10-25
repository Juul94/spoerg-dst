import type { CaseScore, Summary } from "./scoring.js";

const pct = (x: number | null) => (x === null ? "–" : `${(x * 100).toFixed(0)}%`);
const usd = (x: number | null, d = 4) => (x === null ? "n/a" : `$${x.toFixed(d)}`);
const mark = (x: boolean | null) => (x === null ? "–" : x ? "✓" : "✗");

export function table(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  return [line(header), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(line)].join("\n");
}

export function printCases(scores: CaseScore[]): void {
  console.log(
    `\n${table(
      ["case", "type", "pass", "status", "values", "table", "tools", "tokens in/out", "cost", "latency"],
      scores.map((s) => [
        s.id,
        s.type,
        s.pass ? "PASS" : "FAIL",
        s.status,
        s.value_ok === null ? "–" : `${s.answers_matched}/${s.answers_expected}`,
        mark(s.table_ok),
        String(s.tool_calls),
        `${s.input_tokens}/${s.output_tokens}`,
        usd(s.cost_usd),
        `${(s.latency_ms / 1000).toFixed(1)}s`,
      ]),
    )}`,
  );
}

/** One column per run, so runs (models, prompt versions) can be compared side by side. */
export function printSummary(runs: Array<{ name: string; summary: Summary }>): void {
  const metric = (label: string, f: (s: Summary) => string) => [label, ...runs.map((r) => f(r.summary))];
  const types = [...new Set(runs.flatMap((r) => Object.keys(r.summary.pass_rate_by_type)))] as Array<keyof Summary["pass_rate_by_type"]>;
  console.log(
    `\n${table(
      ["metric", ...runs.map((r) => r.name)],
      [
        metric("cases", (s) => String(s.cases)),
        metric("pass rate", (s) => pct(s.pass_rate)),
        metric("value accuracy", (s) => pct(s.value_accuracy)),
        metric("correct table", (s) => pct(s.table_accuracy)),
        metric("correct refusal", (s) => pct(s.refusal_accuracy)),
        metric("false refusal", (s) => pct(s.false_refusal_rate)),
        metric("assumption stated (ambiguous)", (s) => pct(s.assumption_rate)),
        metric("failures", (s) => String(s.failures)),
        metric("avg tool calls", (s) => s.avg_tool_calls.toFixed(1)),
        metric("tokens in / out", (s) => `${s.total_input_tokens} / ${s.total_output_tokens}`),
        metric("total cost", (s) => usd(s.total_cost_usd, 3)),
        metric("cost per question", (s) => usd(s.avg_cost_usd)),
        metric("avg / p95 latency", (s) => `${(s.avg_latency_ms / 1000).toFixed(1)}s / ${(s.p95_latency_ms / 1000).toFixed(1)}s`),
        ...types.map((t) => metric(`pass: ${t}`, (s) => pct(s.pass_rate_by_type[t] ?? null))),
      ],
    )}`,
  );
}
