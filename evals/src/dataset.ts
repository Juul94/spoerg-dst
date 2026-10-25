import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export const DATASET_PATH = fileURLToPath(new URL("../dataset.json", import.meta.url));

/**
 * A reference query that yields exactly one number: "TABLE CODE=value CODE=value",
 * optionally prefixed with "sum " to add up all returned rows (e.g. "sum BIL51 DRIV=20225 Tid=2025M*").
 * Omitted variables use the table's total (elimination), like get_data.
 */
const Ref = z.object({ q: z.string().min(3), value: z.number().nullable() });

const ExpectedAnswer = z.object({
  label: z.string(),
  /** Arithmetic over ref names, e.g. "(b - a) / a * 100". */
  expr: z.string().regex(/^[a-z0-9\s+\-*/().]+$/, "expr may only use ref names, numbers and + - * / ( )"),
  value: z.number().nullable(),
  /** Relative tolerance in percent (default 0.5). Ignored when tol_abs is set. */
  tol_pct: z.number().positive().optional(),
  /** Absolute tolerance, used for percentages and indices. */
  tol_abs: z.number().positive().optional(),
});

export const QuestionType = z.enum(["lookup", "time_comparison", "calculation", "ambiguous", "no_data"]);

export const EvalCase = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    question: z.string().min(5),
    type: QuestionType,
    expect: z.enum(["answered", "not_found"]),
    /** "all": every answer must be found. "any": one is enough (ambiguous questions). */
    match: z.enum(["all", "any"]).default("all"),
    /** Tables that count as a correct source. */
    tables: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    refs: z.record(z.string().regex(/^[a-z]$/), Ref).default({}),
    answers: z.array(ExpectedAnswer).default([]),
  })
  .refine((c) => c.expect === "not_found" || (c.answers.length > 0 && c.tables.length > 0), "answered cases need answers and tables");

export type EvalCase = z.infer<typeof EvalCase>;
export type ExpectedAnswer = z.infer<typeof ExpectedAnswer>;
export type QuestionType = z.infer<typeof QuestionType>;
export const Dataset = z.array(EvalCase);

export async function loadDataset(path = DATASET_PATH): Promise<EvalCase[]> {
  const parsed = Dataset.safeParse(JSON.parse(await readFile(path, "utf8")));
  if (!parsed.success) throw new Error(`Invalid dataset ${path}:\n${z.prettifyError(parsed.error)}`);
  const ids = new Set<string>();
  for (const c of parsed.data) {
    if (ids.has(c.id)) throw new Error(`Duplicate case id ${c.id}`);
    ids.add(c.id);
  }
  return parsed.data;
}

export async function saveDataset(cases: EvalCase[], path = DATASET_PATH): Promise<void> {
  await writeFile(path, `${JSON.stringify(cases, null, 2)}\n`);
}

export interface ParsedRef {
  sum: boolean;
  table: string;
  variables: Array<{ code: string; values: string[] }>;
}

export function parseRef(q: string): ParsedRef {
  const parts = q.trim().split(/\s+/);
  const sum = parts[0] === "sum";
  if (sum) parts.shift();
  const [table, ...vars] = parts;
  if (!table) throw new Error(`Empty ref "${q}"`);
  return {
    sum,
    table,
    variables: vars.map((v) => {
      const eq = v.indexOf("=");
      if (eq <= 0) throw new Error(`Bad variable "${v}" in ref "${q}"`);
      return { code: v.slice(0, eq), values: v.slice(eq + 1).split(",") };
    }),
  };
}

/** Evaluates a small arithmetic expression over named values. Only + - * / and parentheses. */
export function evaluate(expr: string, vars: Record<string, number>): number {
  const tokens = expr.match(/\d+(?:\.\d+)?|[a-z]+|[+\-*/()]/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const primary = (): number => {
    const t = next();
    if (t === undefined) throw new Error(`Unexpected end of "${expr}"`);
    if (t === "(") {
      const v = sum();
      if (next() !== ")") throw new Error(`Missing ) in "${expr}"`);
      return v;
    }
    if (t === "-") return -primary();
    if (/^\d/.test(t)) return Number(t);
    const v = vars[t];
    if (v === undefined) throw new Error(`Unknown name "${t}" in "${expr}"`);
    return v;
  };
  const product = (): number => {
    let v = primary();
    while (peek() === "*" || peek() === "/") v = next() === "*" ? v * primary() : v / primary();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (peek() === "+" || peek() === "-") v = next() === "+" ? v + product() : v - product();
    return v;
  };
  const v = sum();
  if (i !== tokens.length) throw new Error(`Unexpected "${peek()}" in "${expr}"`);
  return v;
}

export function withinTolerance(actual: number, expected: ExpectedAnswer & { value: number }): boolean {
  if (expected.tol_abs !== undefined) return Math.abs(actual - expected.value) <= expected.tol_abs + 1e-9;
  const pct = expected.tol_pct ?? 0.5;
  return Math.abs(actual - expected.value) <= (Math.abs(expected.value) * pct) / 100 + 1e-9;
}
