// Re-fetches every reference value from the live StatBank API and checks the dataset for drift.
// `npm run eval:verify` reports drift; `npm run eval:verify -- --update` writes the live values into dataset.json.
import { parseArgs } from "node:util";
import { clientOptionsFromEnv, GetDataInput, StatbankClient, StatbankTools } from "statbank-mcp";
import { evaluate, loadDataset, parseRef, saveDataset } from "./dataset.js";

const { values: args } = parseArgs({ options: { update: { type: "boolean", default: false } } });
const tools = new StatbankTools(new StatbankClient({ ...clientOptionsFromEnv(), mode: "live" }));

async function fetchRef(t: StatbankTools, q: string): Promise<number> {
  const ref = parseRef(q);
  const out = await t.getData(GetDataInput.parse({ table_id: ref.table, variables: ref.variables, max_rows: 1000, lang: "da" }));
  if (out.truncated) throw new Error(`${q}: result truncated`);
  if (!ref.sum && out.row_count !== 1) throw new Error(`${q}: expected 1 row, got ${out.row_count}`);
  const nums = out.rows.map((r) => r.at(-1));
  if (nums.some((n) => typeof n !== "number")) throw new Error(`${q}: missing values`);
  return (nums as number[]).reduce((a, b) => a + b, 0);
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const cases = await loadDataset();
let drift = 0;
let errors = 0;
for (const c of cases) {
  const live: Record<string, number> = {};
  try {
    for (const [name, ref] of Object.entries(c.refs)) {
      live[name] = await fetchRef(tools, ref.q);
      if (ref.value !== live[name]) {
        if (ref.value !== null) console.log(`drift ${c.id}.${name}: ${ref.value} → ${live[name]}`);
        drift += ref.value === null ? 0 : 1;
        if (args.update) ref.value = live[name];
      }
    }
    for (const a of c.answers) {
      const v = round(evaluate(a.expr, live));
      if (a.value !== v && args.update) a.value = v;
    }
    console.log(`ok    ${c.id.padEnd(30)} ${c.answers.map((a) => `${a.label}=${round(evaluate(a.expr, live))}`).join(", ")}`);
  } catch (e) {
    errors++;
    console.log(`ERROR ${c.id}: ${(e as Error).message}`);
  }
}
if (args.update) await saveDataset(cases);
console.log(`\n${cases.length} cases, ${drift} drifted values, ${errors} errors${args.update ? " (dataset updated)" : ""}`);
process.exit(errors > 0 || (!args.update && drift > 0) ? 1 : 0);
