import { z } from "zod";

/** Zod schemas for the raw StatBank API (api.statbank.dk/v1). Everything that comes back over the wire is parsed through these. */

export const Lang = z.enum(["da", "en"]);
export type Lang = z.infer<typeof Lang>;

export const TableSummary = z.object({
  id: z.string(),
  text: z.string(),
  unit: z.string().nullable().optional(),
  updated: z.string().nullable().optional(),
  firstPeriod: z.string().nullable().optional(),
  latestPeriod: z.string().nullable().optional(),
  active: z.boolean().optional().default(true),
  variables: z.array(z.string()).default([]),
});
export type TableSummary = z.infer<typeof TableSummary>;
export const TableList = z.array(TableSummary);

export const VariableValue = z.object({ id: z.string(), text: z.string() });
export type VariableValue = z.infer<typeof VariableValue>;

export const Variable = z.object({
  id: z.string(),
  text: z.string(),
  elimination: z.boolean().default(false),
  time: z.boolean().default(false),
  map: z.string().nullable().optional(),
  values: z.array(VariableValue),
});
export type Variable = z.infer<typeof Variable>;

export const TableInfo = z.object({
  id: z.string(),
  text: z.string(),
  description: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  suppressedDataValue: z.string().nullable().optional(),
  updated: z.string().nullable().optional(),
  active: z.boolean().optional().default(true),
  footnote: z.unknown().optional(),
  documentation: z.object({ url: z.string().nullable().optional() }).passthrough().nullable().optional(),
  variables: z.array(Variable),
});
export type TableInfo = z.infer<typeof TableInfo>;

export const ApiErrorBody = z.object({
  errorTypeCode: z.string(),
  message: z.string(),
});

export interface DataRequestVariable {
  code: string;
  values: string[];
}

/** One parsed CSV data row: variable code -> value code, plus the numeric cell. */
export interface DataRow {
  keys: Record<string, string>;
  value: number | null;
}
