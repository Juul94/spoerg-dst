import { z } from "zod";
import { TableIndex } from "./search.js";
import { SelectionError, resolveValues, suggest } from "./selection.js";
import { StatbankClient, StatbankError } from "./statbank/client.js";
import { Lang, type DataRequestVariable, type TableInfo, type Variable } from "./statbank/schemas.js";

/**
 * Tool definitions shared by the MCP server and the in-process agent.
 * One source of truth: name, description, Zod input/output schema, handler.
 */

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  openWorldHint?: boolean;
  idempotentHint?: boolean;
}

export interface ToolDef<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  inputSchema: I;
  outputSchema: O;
  annotations: ToolAnnotations;
  handler: (input: z.infer<I>) => Promise<z.infer<O>>;
}

/** An error the caller (usually an LLM) can fix by changing its input. Returned as an is_error tool result. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

export const MAX_CELLS = 20_000;
const STATBANK_TABLE_URL = (id: string) => `https://www.statistikbanken.dk/${id}`;

// ---------- schemas ----------

const LangInput = Lang.default("da").describe('Language of labels in the response: "da" (default) or "en". Codes are the same in both.');

export const SearchTablesInput = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Keywords describing the statistic, Danish or English, e.g. "nyregistrerede personbiler drivmiddel", "population municipality", "ledighed". Use subject nouns, not full questions. Danish keywords usually match best.',
    ),
  limit: z.number().int().min(1).max(25).default(8).describe("Max results (default 8)."),
  include_inactive: z
    .boolean()
    .default(false)
    .describe("Include discontinued tables (no longer updated). Only useful for historical questions."),
  lang: LangInput,
});

const TableHit = z.object({
  id: z.string(),
  title: z.string(),
  unit: z.string().nullable(),
  period: z.string().describe("first–latest period available"),
  variables: z.array(z.string()),
  active: z.boolean(),
  score: z.number(),
});

export const SearchTablesOutput = z.object({
  query: z.string(),
  results: z.array(TableHit),
  total_tables_indexed: z.number(),
  hint: z.string(),
});

export const GetTableInfoInput = z.object({
  table_id: z.string().min(2).max(20).describe('Table id from search_tables, e.g. "BIL51", "FOLK1A".'),
  value_search: z
    .object({
      variable: z.string().describe('Variable code, e.g. "OMRÅDE".'),
      query: z.string().min(1).describe('Text to look for in value labels, e.g. "Aarhus" or "el".'),
    })
    .optional()
    .describe("Find value codes inside one variable whose list is too long to show in full (e.g. municipalities, age)."),
  max_values: z.number().int().min(1).max(200).default(25).describe("Max values listed per variable (default 25)."),
  lang: LangInput,
});

const ValueOut = z.object({ code: z.string(), label: z.string() });

const VariableOut = z.object({
  code: z.string(),
  label: z.string(),
  eliminable: z.boolean().describe("true: may be omitted in get_data, which then returns the total over this variable"),
  is_time: z.boolean(),
  value_count: z.number(),
  values: z.array(ValueOut),
  truncated: z.boolean(),
});

export const GetTableInfoOutput = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  unit: z.string().nullable(),
  updated: z.string().nullable(),
  active: z.boolean(),
  statbank_url: z.string(),
  documentation_url: z.string().nullable(),
  variables: z.array(VariableOut),
  value_search_results: z.array(ValueOut).optional(),
  notes: z.array(z.string()),
});

export const GetDataInput = z.object({
  table_id: z.string().min(2).max(20).describe('Table id, e.g. "BIL51".'),
  variables: z
    .array(
      z.object({
        code: z.string().describe('Variable code from get_table_info, e.g. "DRIV", "Tid", "OMRÅDE".'),
        values: z
          .array(z.string().min(1))
          .min(1)
          .max(500)
          .describe(
            'Value codes or selectors: exact code ("20225"), "*" (all), "(3)" (latest 3 periods), ">=2020M01<=2020M12" (range), "2025M*" (prefix wildcard).',
          ),
      }),
    )
    .default([])
    .describe(
      "Selection per variable. Omitted eliminable variables return their total. Omitted time variable returns the latest period. Non-eliminable variables must be given.",
    ),
  max_rows: z.number().int().min(1).max(1000).default(200).describe("Max rows returned in the response (default 200). The full result is kept for charts."),
  lang: LangInput,
});

const Cell = z.union([z.string(), z.number(), z.null()]);

export const GetDataOutput = z.object({
  result_id: z.string().describe("Reference to the full result, usable for charts."),
  table_id: z.string(),
  title: z.string(),
  unit: z.string().nullable(),
  fixed: z.array(z.object({ code: z.string(), label: z.string(), value: ValueOut })).describe("Variables with exactly one selected value"),
  eliminated: z.array(z.object({ code: z.string(), label: z.string() })).describe("Omitted variables (values are totals over these)"),
  columns: z.array(z.string()),
  rows: z.array(z.array(Cell)),
  row_count: z.number(),
  truncated: z.boolean(),
  summary: z.object({ count: z.number(), nulls: z.number(), min: z.number().nullable(), max: z.number().nullable(), sum: z.number() }),
  source: z.object({
    table_id: z.string(),
    statbank_url: z.string(),
    api_query: z.object({ table: z.string(), lang: Lang, variables: z.array(z.object({ code: z.string(), values: z.array(z.string()) })) }),
  }),
});

export type SearchTablesOutput = z.infer<typeof SearchTablesOutput>;
export type GetTableInfoOutput = z.infer<typeof GetTableInfoOutput>;
export type GetDataOutput = z.infer<typeof GetDataOutput>;

/** Full (untruncated) result kept server-side for charting. */
export interface StoredResult {
  id: string;
  tableId: string;
  title: string;
  unit: string | null;
  columns: string[];
  /** Index of the time column in `columns`, or null when time is fixed. */
  timeColumn: number | null;
  rows: Array<Array<string | number | null>>;
  fixed: GetDataOutput["fixed"];
  source: GetDataOutput["source"];
}

// ---------- service ----------

export class StatbankTools {
  private indexPromise: Promise<TableIndex> | undefined;
  private results = new Map<string, StoredResult>();
  private resultCounter = 0;

  constructor(readonly client: StatbankClient) {}

  index(): Promise<TableIndex> {
    this.indexPromise ??= Promise.all([this.client.tables("da"), this.client.tables("en")])
      .then(([da, en]) => new TableIndex(da, en))
      .catch((err) => {
        this.indexPromise = undefined;
        throw err;
      });
    return this.indexPromise;
  }

  getResult(id: string): StoredResult | undefined {
    return this.results.get(id);
  }

  async searchTables(input: z.infer<typeof SearchTablesInput>): Promise<SearchTablesOutput> {
    const index = await this.index();
    const hits = index.search(input.query, { limit: input.limit, includeInactive: input.include_inactive });
    return {
      query: input.query,
      total_tables_indexed: index.size,
      results: hits.map((h) => ({
        id: h.id,
        title: input.lang === "en" ? h.textEn : h.textDa,
        unit: h.unit,
        period: `${h.firstPeriod ?? "?"}–${h.latestPeriod ?? "?"}`,
        variables: h.variables,
        active: h.active,
        score: h.score,
      })),
      hint:
        hits.length === 0
          ? "No matches. Try fewer or different keywords (Danish often works better), or a broader subject term."
          : "Pick the table whose title, variables and period fit the question, then call get_table_info.",
    };
  }

  async getTableInfo(input: z.infer<typeof GetTableInfoInput>): Promise<GetTableInfoOutput> {
    const info = await this.loadInfo(input.table_id, input.lang);
    const notes = [
      "Time codes: yearly 2025, quarterly 2025K3 (da) / 2025Q3 (en), monthly 2025M09.",
      "Selectors in get_data: exact code, *, (n) latest n, >=A<=B range, prefix* wildcard.",
    ];
    let valueSearch: GetTableInfoOutput["value_search_results"];
    if (input.value_search) {
      const v = findVariable(info, input.value_search.variable);
      valueSearch = suggest(v, input.value_search.query, 50).map((x) => ({ code: x.id, label: x.text }));
      if (valueSearch.length === 0) notes.push(`value_search: nothing in ${v.id} matched "${input.value_search.query}".`);
    }
    return {
      id: info.id,
      title: info.text,
      description: info.description ?? null,
      unit: info.unit ?? null,
      updated: info.updated ?? null,
      active: info.active ?? true,
      statbank_url: STATBANK_TABLE_URL(info.id),
      documentation_url: info.documentation?.url ?? null,
      variables: info.variables.map((v) => trimVariable(v, input.max_values)),
      ...(valueSearch ? { value_search_results: valueSearch } : {}),
      notes,
    };
  }

  async getData(input: z.infer<typeof GetDataInput>): Promise<GetDataOutput> {
    const info = await this.loadInfo(input.table_id, input.lang);
    const requested = new Map<string, string[]>();
    for (const sel of input.variables) {
      const v = findVariable(info, sel.code);
      requested.set(v.id, [...(requested.get(v.id) ?? []), ...sel.values]);
    }

    const resolved: Array<{ variable: Variable; values: Variable["values"] }> = [];
    const eliminated: GetDataOutput["eliminated"] = [];
    for (const v of info.variables) {
      const specs = requested.get(v.id);
      if (specs) {
        resolved.push({ variable: v, values: wrap(() => resolveValues(v, specs)) });
      } else if (v.time) {
        resolved.push({ variable: v, values: wrap(() => resolveValues(v, ["(1)"])) });
      } else if (v.elimination) {
        eliminated.push({ code: v.id, label: v.text });
      } else {
        throw new ToolInputError(
          `Variable ${v.id} (${v.text}) cannot be omitted in table ${info.id}. Choose values, e.g. ${v.values
            .slice(0, 3)
            .map((x) => `${x.id} (${x.text})`)
            .join(", ")}.`,
        );
      }
    }

    const cells = resolved.reduce((n, r) => n * r.values.length, 1);
    if (cells > MAX_CELLS) {
      throw new ToolInputError(
        `Selection would return ${cells.toLocaleString("en")} cells (limit ${MAX_CELLS.toLocaleString("en")}). Narrow it: ${resolved
          .map((r) => `${r.variable.id}=${r.values.length}`)
          .join(", ")}.`,
      );
    }

    const apiVariables: DataRequestVariable[] = resolved.map((r) => ({ code: r.variable.id, values: r.values.map((x) => x.id) }));
    const rows = await wrapAsync(() => this.client.data(info.id, apiVariables, input.lang));

    const fixed = resolved
      .filter((r) => r.values.length === 1)
      .map((r) => ({ code: r.variable.id, label: r.variable.text, value: { code: r.values[0]!.id, label: r.values[0]!.text } }));
    const dims = resolved.filter((r) => r.values.length > 1);
    const labelOf = new Map(dims.map((d) => [d.variable.id.toUpperCase(), new Map(d.values.map((x) => [x.id, x.text]))]));

    const columns = [...dims.map((d) => d.variable.text), "value"];
    const table = rows.map((row) => [
      ...dims.map((d) => {
        const key = row.keys[d.variable.id.toUpperCase()] ?? "";
        return d.variable.time ? key : (labelOf.get(d.variable.id.toUpperCase())?.get(key) ?? key);
      }),
      row.value,
    ]);

    const nums = rows.map((r) => r.value).filter((x): x is number => x !== null);
    const source = {
      table_id: info.id,
      statbank_url: STATBANK_TABLE_URL(info.id),
      api_query: { table: info.id, lang: input.lang, variables: apiVariables },
    };
    const id = `r${++this.resultCounter}_${info.id}`;
    const t = dims.findIndex((d) => d.variable.time);
    this.storeResult({ id, tableId: info.id, title: info.text, unit: info.unit ?? null, columns, timeColumn: t < 0 ? null : t, rows: table, fixed, source });

    return {
      result_id: id,
      table_id: info.id,
      title: info.text,
      unit: info.unit ?? null,
      fixed,
      eliminated,
      columns,
      rows: table.slice(0, input.max_rows),
      row_count: table.length,
      truncated: table.length > input.max_rows,
      summary: {
        count: rows.length,
        nulls: rows.length - nums.length,
        min: nums.length ? Math.min(...nums) : null,
        max: nums.length ? Math.max(...nums) : null,
        sum: round(nums.reduce((a, b) => a + b, 0)),
      },
      source,
    };
  }

  private async loadInfo(tableId: string, lang: Lang): Promise<TableInfo> {
    try {
      return await this.client.tableInfo(tableId, lang);
    } catch (err) {
      if (err instanceof StatbankError && err.status !== undefined && err.status < 500) {
        const index = await this.index().catch(() => undefined);
        const near = index?.search(tableId, { limit: 3 }).map((h) => h.id) ?? [];
        throw new ToolInputError(`Table "${tableId}" not found (${err.code}: ${err.message}).${near.length ? ` Similar ids: ${near.join(", ")}.` : " Use search_tables."}`);
      }
      throw err;
    }
  }

  private storeResult(r: StoredResult) {
    this.results.set(r.id, r);
    if (this.results.size > 200) this.results.delete(this.results.keys().next().value!);
  }
}

function trimVariable(v: Variable, maxValues: number): z.infer<typeof VariableOut> {
  // For time, the most recent periods are the useful ones; for others, the first values (usually totals) are.
  const values = v.time ? [v.values[0]!, ...v.values.slice(-Math.max(1, maxValues - 1))] : v.values.slice(0, maxValues);
  const unique = [...new Map(values.map((x) => [x.id, x])).values()];
  return {
    code: v.id,
    label: v.text,
    eliminable: v.elimination,
    is_time: v.time,
    value_count: v.values.length,
    values: unique.map((x) => ({ code: x.id, label: x.text })),
    truncated: unique.length < v.values.length,
  };
}

function findVariable(info: TableInfo, code: string): Variable {
  const v =
    info.variables.find((x) => x.id === code) ??
    info.variables.find((x) => x.id.toLowerCase() === code.toLowerCase()) ??
    info.variables.find((x) => x.text.toLowerCase() === code.toLowerCase());
  if (!v) throw new ToolInputError(`Table ${info.id} has no variable "${code}". Variables: ${info.variables.map((x) => `${x.id} (${x.text})`).join(", ")}.`);
  return v;
}

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof SelectionError) throw new ToolInputError(err.message);
    throw err;
  }
}

async function wrapAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof StatbankError && err.status !== undefined && err.status < 500) throw new ToolInputError(`StatBank rejected the query (${err.code}): ${err.message}`);
    throw err;
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

// ---------- definitions ----------

export function createToolDefs(tools: StatbankTools): ToolDef[] {
  const defs = [
    {
      name: "search_tables",
      title: "Search StatBank tables",
      description:
        "Search the ~2,300 tables in Statistics Denmark's StatBank by keywords (Danish or English). Returns table ids, titles, units, available period range and variable names. Use this first to find candidate tables; prefer active tables whose period covers the question. Returns an empty list when nothing matches — then try other keywords before concluding that no data exists.",
      inputSchema: SearchTablesInput,
      outputSchema: SearchTablesOutput,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
      handler: (i: z.infer<typeof SearchTablesInput>) => tools.searchTables(i),
    },
    {
      name: "get_table_info",
      title: "Get table metadata",
      description:
        "Get a table's metadata: description, unit, and each variable with its code, whether it can be omitted (eliminable), and its value codes. Long value lists are truncated (time shows the newest periods); use value_search to find specific codes such as a municipality or age group. Call this before get_data so you use valid codes.",
      inputSchema: GetTableInfoInput,
      outputSchema: GetTableInfoOutput,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
      handler: (i: z.infer<typeof GetTableInfoInput>) => tools.getTableInfo(i),
    },
    {
      name: "get_data",
      title: "Get table data",
      description:
        "Fetch numbers from a StatBank table. Give value codes per variable (from get_table_info). Omitted eliminable variables are summed to their total; omitted time gives the latest period; non-eliminable variables must be given. Codes are validated before the request and invalid ones return suggestions. Selections above 20,000 cells are rejected — select only what the question needs. Returns rows with labels, a summary, a result_id for charts, and the exact API query as the source.",
      inputSchema: GetDataInput,
      outputSchema: GetDataOutput,
      annotations: { readOnlyHint: true, openWorldHint: true, idempotentHint: true },
      handler: (i: z.infer<typeof GetDataInput>) => tools.getData(i),
    },
  ];
  return defs as unknown as ToolDef[];
}
