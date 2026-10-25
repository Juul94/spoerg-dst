import { fold } from "./search.js";
import type { Variable, VariableValue } from "./statbank/schemas.js";

/**
 * Resolves the selector syntax the tools accept into explicit value codes, locally, against cached metadata.
 * Doing it locally means we can (1) reject bad codes with helpful suggestions before calling the API,
 * and (2) know the exact cell count before fetching.
 *
 * Supported per item: exact code, exact label, "*", "2025M*" (prefix wildcard), "(3)" (latest 3), ">=2020<=2024" (range).
 */
export class SelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectionError";
  }
}

export function resolveValues(variable: Variable, specs: string[]): VariableValue[] {
  const values = variable.values;
  const picked = new Map<string, VariableValue>();
  const add = (v: VariableValue[]) => v.forEach((x) => picked.set(x.id, x));

  for (const raw of specs) {
    const spec = raw.trim();
    if (spec === "*") {
      add(values);
      continue;
    }
    const latest = /^\((\d+)\)$/.exec(spec);
    if (latest) {
      const n = Number(latest[1]);
      add(values.slice(Math.max(0, values.length - n)));
      continue;
    }
    const range = /^(?:>=\s*([^<>=]+?))?\s*(?:<=\s*([^<>=]+))?$/.exec(spec);
    if (range && (spec.startsWith(">=") || spec.startsWith("<="))) {
      const from = range[1] ? indexOf(variable, range[1].trim()) : 0;
      const to = range[2] ? indexOf(variable, range[2].trim()) : values.length - 1;
      if (from > to) throw new SelectionError(`Empty range "${spec}" for ${variable.id}.`);
      add(values.slice(from, to + 1));
      continue;
    }
    if (spec.includes("*")) {
      const re = new RegExp(`^${spec.split("*").map(escapeRe).join(".*")}$`, "i");
      const m = values.filter((v) => re.test(v.id));
      if (m.length === 0) throw new SelectionError(`"${spec}" matches no values of ${variable.id}. ${describe(variable)}`);
      add(m);
      continue;
    }
    add([values[indexOf(variable, spec)]!]);
  }
  if (picked.size === 0) throw new SelectionError(`No values selected for ${variable.id}.`);
  // keep metadata order (chronological for time)
  return values.filter((v) => picked.has(v.id));
}

function indexOf(variable: Variable, spec: string): number {
  const values = variable.values;
  let i = values.findIndex((v) => v.id === spec);
  if (i < 0) i = values.findIndex((v) => v.id.toLowerCase() === spec.toLowerCase());
  if (i < 0) i = values.findIndex((v) => fold(v.text) === fold(spec));
  if (i < 0 && variable.time) i = values.findIndex((v) => v.id === spec.replace(/Q(\d)$/i, "K$1")) ;
  if (i < 0 && variable.time) i = values.findIndex((v) => v.id === spec.replace(/K(\d)$/i, "Q$1"));
  if (i >= 0) return i;
  const suggestions = suggest(variable, spec);
  throw new SelectionError(
    `Unknown value "${spec}" for variable ${variable.id} (${variable.text}).` +
      (suggestions.length ? ` Did you mean: ${suggestions.map((s) => `${s.id} (${s.text})`).join(", ")}?` : "") +
      ` ${describe(variable)}`,
  );
}

export function suggest(variable: Variable, spec: string, limit = 5): VariableValue[] {
  const q = fold(spec);
  return variable.values
    .map((v) => {
      const t = fold(v.text);
      const id = v.id.toLowerCase();
      const score = t.includes(q) || id.includes(q) ? 2 : q.includes(t) && t.length > 2 ? 1 : 0;
      return { v, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.v);
}

function describe(variable: Variable): string {
  const v = variable.values;
  if (variable.time) return `Available periods: ${v[0]?.id} … ${v.at(-1)?.id} (${v.length}).`;
  return `Call get_table_info with value_search to find codes (${v.length} values).`;
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
