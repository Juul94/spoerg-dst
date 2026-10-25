// Runs the agent over the dataset and scores it.
// npm run eval -- [--model haiku|sonnet|<id>] [--prompt v1] [--subset ci|type:ambiguous|id,id] [--concurrency 3] [--yes] [--min-pass 0.6]
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { costUsd, DEFAULT_PROMPT, PROMPTS, resolveModel, runAgent, type AgentResult, type PromptVersion } from "@spoerg-dst/agent";
import { clientOptionsFromEnv, StatbankClient, StatbankTools } from "statbank-mcp";
import { loadDataset } from "./dataset.js";
import { scoreCase, selectCases, summarize, type CaseScore, type Summary } from "./scoring.js";
import { printCases, printSummary } from "./report.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const RESULTS_DIR = fileURLToPath(new URL("../results", import.meta.url));
try {
  process.loadEnvFile(`${root}.env`);
} catch {
  // no .env file: rely on the environment
}

const { values: args } = parseArgs({
  options: {
    model: { type: "string", default: "haiku" },
    prompt: { type: "string", default: DEFAULT_PROMPT },
    subset: { type: "string" },
    concurrency: { type: "string", default: "3" },
    "max-steps": { type: "string", default: "12" },
    yes: { type: "boolean", default: false },
    "min-pass": { type: "string", default: "0" },
  },
});

const model = resolveModel(args.model);
if (!(args.prompt in PROMPTS)) throw new Error(`Unknown prompt "${args.prompt}". Available: ${Object.keys(PROMPTS).join(", ")}`);
const cases = selectCases(await loadDataset(), args.subset);

/** Cost per case from the latest run with this model, else a rough token profile (~45K input mostly cached, ~2.5K output). */
async function estimatePerCase(): Promise<{ usd: number | null; basis: string }> {
  try {
    const files = (await readdir(RESULTS_DIR)).filter((f) => f.endsWith(".json") && f.includes(model)).sort();
    const last = files.at(-1);
    if (last) {
      const prev = JSON.parse(await readFile(join(RESULTS_DIR, last), "utf8")) as { summary: Summary };
      if (prev.summary.avg_cost_usd !== null) return { usd: prev.summary.avg_cost_usd, basis: `last run ${last}` };
    }
  } catch {
    // no previous results
  }
  return {
    usd: costUsd(model, { input_tokens: 12_000, output_tokens: 2_500, cache_read_input_tokens: 30_000, cache_creation_input_tokens: 4_000 }),
    basis: "token heuristic",
  };
}

const est = await estimatePerCase();
const estTotal = est.usd === null ? null : est.usd * cases.length;
console.log(`${cases.length} cases · ${model} · prompt ${args.prompt} · estimated ${estTotal === null ? "unknown cost" : `$${estTotal.toFixed(2)}`} (${est.basis})`);
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(2);
}
if ((estTotal === null || estTotal > 0.5) && !args.yes) {
  console.error("Estimated cost is above $0.50. Re-run with --yes to confirm.");
  process.exit(2);
}

const client = new StatbankClient(clientOptionsFromEnv());
const startedAt = new Date().toISOString();
const results: Array<{ score: CaseScore; result: AgentResult }> = new Array(cases.length);
let nextIndex = 0;
let done = 0;
async function worker() {
  while (nextIndex < cases.length) {
    const i = nextIndex++;
    const c = cases[i]!;
    const result = await runAgent(c.question, {
      tools: new StatbankTools(client),
      model,
      promptVersion: args.prompt as PromptVersion,
      maxSteps: Number(args["max-steps"]),
    });
    const score = scoreCase(c, result);
    results[i] = { score, result };
    console.log(`[${++done}/${cases.length}] ${score.pass ? "PASS" : "FAIL"} ${c.id}${score.failure ? ` (${score.failure})` : ""}`);
  }
}
await Promise.all(Array.from({ length: Math.max(1, Number(args.concurrency)) }, worker));

const scores = results.map((r) => r.score);
const summary = summarize(scores);
printCases(scores);
printSummary([{ name: `${model} ${args.prompt}`, summary }]);

await mkdir(RESULTS_DIR, { recursive: true });
const file = join(RESULTS_DIR, `${startedAt.replace(/[:.]/g, "-")}_${model}_${args.prompt}${args.subset ? `_${args.subset.replace(/[^a-z0-9-]/gi, "-")}` : ""}.json`);
await writeFile(
  file,
  JSON.stringify({ run: { started_at: startedAt, model, prompt: args.prompt, subset: args.subset ?? null, cases: cases.length }, summary, cases: results }, null, 2),
);
console.log(`\nSaved ${file}`);
process.exit(summary.pass_rate < Number(args["min-pass"]) ? 1 : 0);
