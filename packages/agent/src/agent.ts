import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { createToolDefs, ToolInputError, type StatbankTools, type ToolDef } from "statbank-mcp";
import { z } from "zod";
import { SUBMIT_ANSWER_DESCRIPTION, SubmitAnswerInput, validateAnswer } from "./answer.js";
import { buildChart, type ChartSpec } from "./chart.js";
import { addUsage, costUsd, emptyUsage, resolveModel, type Usage } from "./pricing.js";
import { DEFAULT_PROMPT, systemPrompt, type PromptVersion } from "./prompts.js";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** The subset of the Anthropic client the agent uses, so tests can pass a fake. */
export interface MessagesClient {
  messages: { create(body: Anthropic.MessageCreateParamsNonStreaming, opts?: { signal?: AbortSignal }): PromiseLike<Anthropic.Message> };
}

export interface AgentOptions {
  tools: StatbankTools;
  client?: MessagesClient;
  model?: string;
  promptVersion?: PromptVersion;
  effort?: "low" | "medium" | "high";
  maxSteps?: number;
  timeoutMs?: number;
  maxTokens?: number;
  today?: string;
  onEvent?: (e: AgentEvent) => void;
}

export type FailureReason = "max_steps" | "timeout" | "api_error" | "no_answer" | "refusal";

export type AgentEvent =
  | { type: "start"; run_id: string; question: string; model: string; prompt_version: string }
  | { type: "llm"; step: number; latency_ms: number; stop_reason: string | null; usage: Usage }
  | { type: "tool_call"; step: number; id: string; tool: string; input: unknown; reason: string }
  | { type: "tool_result"; step: number; id: string; tool: string; ok: boolean; latency_ms: number; preview: string }
  | { type: "final"; result: AgentResult };

export interface TraceStep {
  step: number;
  tool: string;
  input: unknown;
  reason: string;
  ok: boolean;
  latency_ms: number;
  output_preview: string;
}

export interface Trace {
  run_id: string;
  question: string;
  model: string;
  prompt_version: string;
  started_at: string;
  latency_ms: number;
  llm_calls: Array<{ step: number; latency_ms: number; stop_reason: string | null; usage: Usage }>;
  steps: TraceStep[];
  tool_calls: number;
  usage: Usage;
  cost_usd: number | null;
}

export interface Source {
  result_id: string;
  table_id: string;
  title: string;
  statbank_url: string;
  api_query: { table: string; lang: string; variables: Array<{ code: string; values: string[] }> };
}

export interface AgentResult {
  status: "answered" | "not_found" | "failed";
  answer: string;
  values: SubmitAnswerInput["values"];
  calculation?: string;
  assumptions?: string;
  chart: ChartSpec | null;
  sources: Source[];
  failure?: { reason: FailureReason; message: string };
  trace: Trace;
}

const SUBMIT = "submit_answer";
const PREVIEW_CHARS = 400;

export function toAnthropicTool(name: string, description: string, schema: z.ZodObject): Anthropic.Tool {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return { name, description, input_schema: json as Anthropic.Tool["input_schema"] };
}

/** Crude but sufficient: decides the language of fallback messages only. The model answers in the question's language. */
export const isDanish = (q: string) => /[æøå]|\b(hvor|hvad|hvilke|mange|og|i|af|til|der|er|blev|antal)\b/i.test(q);

export async function runAgent(question: string, opts: AgentOptions): Promise<AgentResult> {
  const model = resolveModel(opts.model ?? DEFAULT_MODEL);
  const promptVersion = opts.promptVersion ?? DEFAULT_PROMPT;
  const maxSteps = opts.maxSteps ?? 12;
  const client = opts.client ?? new Anthropic({ maxRetries: 3, timeout: 60_000 });
  const emit = opts.onEvent ?? (() => {});
  const started = Date.now();
  const runId = randomUUID();

  const defs = new Map<string, ToolDef>(createToolDefs(opts.tools).map((d) => [d.name, d]));
  const tools: Anthropic.Tool[] = [
    ...[...defs.values()].map((d) => toAnthropicTool(d.name, d.description, d.inputSchema)),
    toAnthropicTool(SUBMIT, SUBMIT_ANSWER_DESCRIPTION, SubmitAnswerInput),
  ];
  const system = systemPrompt(promptVersion, opts.today ?? new Date().toISOString().slice(0, 10));
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: question }];

  const trace: Trace = {
    run_id: runId,
    question,
    model,
    prompt_version: promptVersion,
    started_at: new Date(started).toISOString(),
    latency_ms: 0,
    llm_calls: [],
    steps: [],
    tool_calls: 0,
    usage: emptyUsage(),
    cost_usd: 0,
  };
  emit({ type: "start", run_id: runId, question, model, prompt_version: promptVersion });

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 180_000);

  const finish = (r: Omit<AgentResult, "trace">): AgentResult => {
    clearTimeout(timer);
    trace.latency_ms = Date.now() - started;
    trace.cost_usd = costUsd(model, trace.usage);
    const result = { ...r, trace };
    emit({ type: "final", result });
    return result;
  };
  const fail = (reason: FailureReason, message: string) =>
    finish({
      status: "failed",
      answer: isDanish(question) ? `Kunne ikke finde et svar (${message}).` : `Could not find an answer (${message}).`,
      values: [],
      chart: null,
      sources: [],
      failure: { reason, message },
    });

  let nudged = false;
  try {
    for (let step = 1; step <= maxSteps; step++) {
      const t0 = Date.now();
      const response = await client.messages.create(
        {
          model,
          max_tokens: opts.maxTokens ?? 8000,
          system,
          tools,
          messages,
          // Caches tools + system + the growing conversation; each step re-reads the prefix at 0.1x.
          cache_control: { type: "ephemeral" },
          ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
        },
        { signal: abort.signal },
      );
      const usage = addUsage(emptyUsage(), response.usage);
      addUsage(trace.usage, usage);
      const call = { step, latency_ms: Date.now() - t0, stop_reason: response.stop_reason, usage };
      trace.llm_calls.push(call);
      emit({ type: "llm", ...call });

      if (response.stop_reason === "refusal") return fail("refusal", "the model declined the request");
      messages.push({ role: "assistant", content: response.content });

      const uses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const reason = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text.trim())
        .join(" ");

      if (uses.length === 0) {
        if (nudged) return fail("no_answer", "the model stopped without submitting an answer");
        nudged = true;
        messages.push({ role: "user", content: `Finish by calling ${SUBMIT}.` });
        continue;
      }

      const results: Anthropic.ToolResultBlockParam[] = [];
      // Data tools first, so a submit_answer in the same turn can reference their results.
      for (const use of [...uses].sort((a, b) => Number(a.name === SUBMIT) - Number(b.name === SUBMIT))) {
        emit({ type: "tool_call", step, id: use.id, tool: use.name, input: use.input, reason });
        const t1 = Date.now();

        if (use.name === SUBMIT) {
          const parsed = SubmitAnswerInput.safeParse(use.input);
          const problems = parsed.success ? validateAnswer(parsed.data, (id) => opts.tools.getResult(id)) : [z.prettifyError(parsed.error)];
          record(step, use, reason, problems.length === 0, Date.now() - t1, problems.join(" ") || "accepted");
          if (parsed.success && problems.length === 0) return finish(toResult(parsed.data, opts.tools));
          results.push({ type: "tool_result", tool_use_id: use.id, is_error: true, content: `Answer rejected: ${problems.join(" ")}` });
          continue;
        }

        const def = defs.get(use.name);
        let content: string;
        let ok = true;
        try {
          if (!def) throw new ToolInputError(`Unknown tool "${use.name}".`);
          const input = def.inputSchema.safeParse(use.input);
          if (!input.success) throw new ToolInputError(z.prettifyError(input.error));
          content = JSON.stringify(await def.handler(input.data));
        } catch (err) {
          ok = false;
          const msg = err instanceof Error ? err.message : String(err);
          content = err instanceof ToolInputError ? msg : `Temporary error, you may retry: ${msg}`;
        }
        trace.tool_calls++;
        record(step, use, reason, ok, Date.now() - t1, content);
        results.push({ type: "tool_result", tool_use_id: use.id, content, ...(ok ? {} : { is_error: true }) });
      }
      messages.push({ role: "user", content: results });
      if (abort.signal.aborted) return fail("timeout", "time limit reached");
    }
    return fail("max_steps", `no answer within ${maxSteps} steps`);
  } catch (err) {
    if (abort.signal.aborted) return fail("timeout", "time limit reached");
    const message = err instanceof Anthropic.APIError ? `API error ${err.status ?? ""}: ${err.message}` : err instanceof Error ? err.message : String(err);
    return fail("api_error", message);
  } finally {
    clearTimeout(timer);
  }

  function record(step: number, use: Anthropic.ToolUseBlock, reason: string, ok: boolean, latency: number, output: string) {
    const preview = output.length > PREVIEW_CHARS ? `${output.slice(0, PREVIEW_CHARS)}…` : output;
    trace.steps.push({ step, tool: use.name, input: use.input, reason, ok, latency_ms: latency, output_preview: preview });
    emit({ type: "tool_result", step, id: use.id, tool: use.name, ok, latency_ms: latency, preview });
  }
}

function toResult(a: SubmitAnswerInput, tools: StatbankTools): Omit<AgentResult, "trace"> {
  const sources = a.result_ids.flatMap((id) => {
    const r = tools.getResult(id);
    return r ? [{ result_id: id, table_id: r.tableId, title: r.title, statbank_url: r.source.statbank_url, api_query: r.source.api_query }] : [];
  });
  const chartResult = a.chart && tools.getResult(a.chart.result_id);
  return {
    status: a.status,
    answer: a.answer,
    values: a.values,
    ...(a.calculation ? { calculation: a.calculation } : {}),
    ...(a.assumptions ? { assumptions: a.assumptions } : {}),
    chart: a.chart && chartResult ? buildChart(chartResult, a.chart.type, a.chart.title) : null,
    sources,
  };
}
