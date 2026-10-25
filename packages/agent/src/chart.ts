import type { StoredResult } from "statbank-mcp";

/** Chart-library-agnostic spec: one row per x value, one key per series. */
export interface ChartSpec {
  type: "line" | "bar";
  title: string;
  unit: string | null;
  xLabel: string;
  series: string[];
  data: Array<Record<string, string | number | null>>;
}

const MAX_SERIES = 12;

/** Builds a chart from the full stored result: x = time (or the first dimension), other dimensions become series. */
export function buildChart(r: StoredResult, type: "line" | "bar", title?: string): ChartSpec {
  const dims = r.columns.length - 1;
  const xCol = r.timeColumn ?? 0;
  const label = title ?? r.title;
  if (dims === 0) {
    return { type: "bar", title: label, unit: r.unit, xLabel: "", series: ["value"], data: [{ x: r.fixed.map((f) => f.value.label).join(", ") || r.title, value: r.rows[0]?.[0] ?? null }] };
  }
  const order: string[] = [];
  const byX = new Map<string, Record<string, string | number | null>>();
  const series = new Set<string>();
  for (const row of r.rows) {
    const x = String(row[xCol]);
    const name = dims === 1 ? "value" : row.slice(0, dims).filter((_, i) => i !== xCol).join(" · ");
    if (!series.has(name) && series.size >= MAX_SERIES) continue;
    series.add(name);
    if (!byX.has(x)) {
      byX.set(x, { x });
      order.push(x);
    }
    byX.get(x)![name] = row[dims] ?? null;
  }
  return { type, title: label, unit: r.unit, xLabel: r.columns[xCol] ?? "", series: [...series], data: order.map((x) => byX.get(x)!) };
}
