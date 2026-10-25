import { z } from "zod";
import type { StoredResult } from "statbank-mcp";

export const SubmitAnswerInput = z.object({
  status: z.enum(["answered", "not_found"]).describe('"answered" when the data answers the question; "not_found" when StatBank has no suitable data.'),
  answer: z.string().min(1).describe("1-4 sentences in the language of the question. Include the key numbers with unit and period."),
  values: z
    .array(
      z.object({
        label: z.string(),
        value: z.number(),
        unit: z.string().optional(),
        period: z.string().optional(),
        computed: z.boolean().default(false).describe("true if you calculated it (sum, change, %), false if copied from a get_data row"),
      }),
    )
    .max(30)
    .default([])
    .describe("The key numbers behind the answer."),
  calculation: z.string().optional().describe("How computed values were derived, e.g. '(14948 - 6953) / 6953 = 115%'."),
  assumptions: z.string().optional().describe("Interpretation chosen for an ambiguous question."),
  result_ids: z.array(z.string()).default([]).describe("result_id of each get_data call the answer is based on."),
  chart: z
    .object({ result_id: z.string(), type: z.enum(["line", "bar"]), title: z.string().optional() })
    .optional()
    .describe("Optional chart of one get_data result: line for time series, bar for categories."),
});
export type SubmitAnswerInput = z.infer<typeof SubmitAnswerInput>;

export const SUBMIT_ANSWER_DESCRIPTION =
  "Submit the final answer. Call exactly once, at the end. For status answered, list the result_ids used and the key values; values not copied from a get_data row must have computed: true and be explained in calculation. For status not_found, explain in answer what was searched and why it does not fit.";

/**
 * Checks that the answer is grounded in fetched data. Returns problems the model can fix,
 * or an empty list. This catches hallucinated numbers before they reach the user.
 */
export function validateAnswer(a: SubmitAnswerInput, getResult: (id: string) => StoredResult | undefined): string[] {
  if (a.status === "not_found") return [];
  const problems: string[] = [];
  if (a.result_ids.length === 0) problems.push("status answered requires at least one result_id from get_data.");
  const results = a.result_ids.map((id) => getResult(id));
  a.result_ids.forEach((id, i) => {
    if (!results[i]) problems.push(`Unknown result_id "${id}".`);
  });
  if (a.chart && !getResult(a.chart.result_id)) problems.push(`Unknown chart result_id "${a.chart.result_id}".`);

  const numbers = results.flatMap((r) => r?.rows.map((row) => row.at(-1)).filter((x): x is number => typeof x === "number") ?? []);
  for (const v of a.values) {
    if (v.computed) continue;
    if (!numbers.some((n) => Math.abs(n - v.value) <= Math.max(Math.abs(n) * 0.005, 0.05))) {
      problems.push(`Value ${v.value} (${v.label}) is not in the referenced results. Fix it, or set computed: true and explain the calculation.`);
    }
  }
  if (a.values.some((v) => v.computed) && !a.calculation) problems.push("Computed values require a calculation.");
  return problems;
}
