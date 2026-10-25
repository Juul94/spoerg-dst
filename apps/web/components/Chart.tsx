"use client";

import type { ChartSpec } from "@spoerg-dst/agent";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];
const fmt = (v: unknown) => (typeof v === "number" ? v.toLocaleString("da-DK") : String(v ?? ""));

export function Chart({ spec }: { spec: ChartSpec }) {
  const common = { data: spec.data, margin: { top: 8, right: 16, bottom: 8, left: 8 } };
  const axes = (
    <>
      <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" />
      <XAxis dataKey="x" tick={{ fill: "var(--muted)", fontSize: 12 }} stroke="var(--line)" />
      <YAxis tickFormatter={fmt} tick={{ fill: "var(--muted)", fontSize: 12 }} stroke="var(--line)" width={72} />
      <Tooltip
        formatter={fmt}
        contentStyle={{ background: "var(--panel)", border: "1px solid var(--line)", borderRadius: 8, color: "var(--ink)" }}
      />
      {spec.series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
    </>
  );

  return (
    <figure className="rounded-xl border border-line bg-panel p-4">
      <figcaption className="mb-3 text-sm font-medium">
        {spec.title}
        {spec.unit && <span className="ml-2 font-normal text-muted">({spec.unit})</span>}
      </figcaption>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {spec.type === "line" ? (
            <LineChart {...common}>
              {axes}
              {spec.series.map((s, i) => (
                <Line key={s} dataKey={s} type="monotone" stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={spec.data.length < 30} connectNulls />
              ))}
            </LineChart>
          ) : (
            <BarChart {...common}>
              {axes}
              {spec.series.map((s, i) => (
                <Bar key={s} dataKey={s} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </figure>
  );
}
