import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { clientOptionsFromEnv, StatbankClient, StatbankTools } from "statbank-mcp";
import { DEFAULT_MODEL, runAgent, type AgentEvent } from "./agent.js";
import { DEMO_MODEL, DEMO_QUESTIONS, demoClient } from "./demo.js";
import { PROMPTS, DEFAULT_PROMPT, type PromptVersion } from "./prompts.js";
import { writeTrace } from "./trace.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
try {
  process.loadEnvFile(`${root}.env`);
} catch {
  // no .env file: rely on the environment
}

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    model: { type: "string", default: process.env.AGENT_MODEL ?? DEFAULT_MODEL },
    prompt: { type: "string", default: process.env.AGENT_PROMPT_VERSION ?? DEFAULT_PROMPT },
    effort: { type: "string" },
    "max-steps": { type: "string", default: "12" },
    json: { type: "boolean", default: false },
    demo: { type: "boolean", default: false },
  },
});

const question = positionals.join(" ").trim();
if (!question) {
  console.error('Usage: npm run ask -- "Hvor mange elbiler blev indregistreret i 2025?" [--model haiku] [--prompt v1] [--json]');
  process.exit(2);
}
const demo = args.demo ? demoClient(question) : null;
if (args.demo && !demo) {
  console.error(["--demo only knows these questions:", ...DEMO_QUESTIONS.map((q) => `  ${q}`)].join("\n"));
  process.exit(2);
}
if (!demo && !process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(2);
}
if (!(args.prompt in PROMPTS)) {
  console.error(`Unknown prompt version "${args.prompt}". Available: ${Object.keys(PROMPTS).join(", ")}`);
  process.exit(2);
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const onEvent = (e: AgentEvent) => {
  if (args.json) return;
  if (e.type === "tool_call") {
    if (e.reason) console.log(dim(`  ${e.reason}`));
    console.log(`→ ${e.tool} ${JSON.stringify(e.input)}`);
  } else if (e.type === "tool_result") {
    console.log(dim(`  ${e.ok ? "ok" : "error"} ${e.latency_ms}ms ${e.ok ? "" : e.preview}`));
  }
};

const tools = new StatbankTools(new StatbankClient(clientOptionsFromEnv()));
const result = await runAgent(question, {
  tools,
  model: demo ? DEMO_MODEL : args.model,
  ...(demo ? { client: demo } : {}),
  promptVersion: args.prompt as PromptVersion,
  maxSteps: Number(args["max-steps"]),
  ...(args.effort ? { effort: args.effort as "low" | "medium" | "high" } : {}),
  onEvent,
});
const file = await writeTrace(process.env.TRACE_DIR ?? `${root}traces`, result);

if (args.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const t = result.trace;
  console.log(`\n${result.answer}`);
  if (result.calculation) console.log(dim(`Calculation: ${result.calculation}`));
  if (result.assumptions) console.log(dim(`Assumption: ${result.assumptions}`));
  for (const s of result.sources) {
    console.log(dim(`Source: ${s.table_id} – ${s.title} ${s.statbank_url}`));
    console.log(dim(`        ${s.api_query.variables.map((v) => `${v.code}=${v.values.join(",")}`).join("; ")}`));
  }
  if (result.chart) console.log(dim(`Chart: ${result.chart.type}, ${result.chart.series.length} series × ${result.chart.data.length} points`));
  const cost = t.cost_usd === null ? "n/a" : `$${t.cost_usd.toFixed(4)}`;
  console.log(dim(`\n${result.status} · ${t.model} · ${t.tool_calls} tool calls · ${t.usage.input_tokens + t.usage.cache_read_input_tokens + t.usage.cache_creation_input_tokens} in / ${t.usage.output_tokens} out tokens · ${cost} · ${(t.latency_ms / 1000).toFixed(1)}s`));
  console.log(dim(`Trace: ${file}`));
}
process.exit(result.status === "failed" ? 1 : 0);
