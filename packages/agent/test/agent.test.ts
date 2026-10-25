import type Anthropic from "@anthropic-ai/sdk";
import { fileURLToPath } from "node:url";
import { StatbankClient, StatbankTools } from "statbank-mcp";
import { describe, expect, it } from "vitest";
import { runAgent, type AgentEvent, type MessagesClient } from "../src/agent.js";

const fixturesDir = fileURLToPath(new URL("../../mcp-server/fixtures", import.meta.url));
const replayTools = () => new StatbankTools(new StatbankClient({ mode: "replay", fixturesDir }));

type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown };
type Turn = Block[] | ((body: Anthropic.MessageCreateParamsNonStreaming) => Block[]);

/** Plays scripted assistant turns and records each request. */
function fakeClient(turns: Turn[], stop: Anthropic.Message["stop_reason"] = "tool_use") {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  let n = 0;
  const client: MessagesClient = {
    messages: {
      async create(body) {
        requests.push(structuredClone(body));
        const turn = turns[n++];
        if (!turn) throw new Error("fakeClient: script exhausted");
        const blocks = typeof turn === "function" ? turn(body) : turn;
        const content = blocks.map((b, i) => (b.type === "tool_use" ? { ...b, id: `tu_${n}_${i}` } : { ...b, citations: null }));
        return {
          id: `msg_${n}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content,
          stop_reason: content.some((b) => b.type === "tool_use") ? stop : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
        } as unknown as Anthropic.Message;
      },
    },
  };
  return { client, requests };
}

const say = (text: string): Block => ({ type: "text", text });
const use = (name: string, input: unknown): Block => ({ type: "tool_use", name, input });
const bil51Query = { table_id: "BIL51", variables: [{ code: "DRIV", values: ["20225", "20205"] }, { code: "Tid", values: ["2026M09"] }] };

/** Reads the result_id from the last get_data tool_result in the request. */
function lastResultId(body: Anthropic.MessageCreateParamsNonStreaming): string {
  const last = body.messages.at(-1)!;
  const blocks = last.content as Anthropic.ToolResultBlockParam[];
  return JSON.parse(String(blocks.at(-1)!.content)).result_id;
}

describe("runAgent", () => {
  it("runs search → info → data → submit and returns a grounded, sourced answer", async () => {
    const events: AgentEvent[] = [];
    const { client, requests } = fakeClient([
      [say("Finder tabeller om nyregistrerede biler."), use("search_tables", { query: "nyregistrerede personbiler drivmiddel" })],
      [use("get_table_info", { table_id: "BIL51" })],
      [say("Henter el og benzin for september 2026."), use("get_data", bil51Query)],
      (body) => {
        const id = lastResultId(body);
        return [
          use("submit_answer", {
            status: "answered",
            answer: "I september 2026 blev der indregistreret 17.778 elbiler og 1.665 benzinbiler.",
            values: [
              { label: "El", value: 17778, period: "2026M09" },
              { label: "Benzin", value: 1665, period: "2026M09" },
            ],
            result_ids: [id],
            chart: { result_id: id, type: "bar" },
          }),
        ];
      },
    ]);
    const r = await runAgent("Hvor mange elbiler og benzinbiler blev indregistreret i september 2026?", {
      tools: replayTools(),
      client,
      model: "haiku",
      onEvent: (e) => events.push(e),
    });

    expect(r.status).toBe("answered");
    expect(r.sources).toEqual([expect.objectContaining({ table_id: "BIL51", statbank_url: "https://www.statistikbanken.dk/BIL51" })]);
    expect(r.sources[0]!.api_query.variables).toEqual(expect.arrayContaining([{ code: "Tid", values: ["2026M09"] }]));
    expect(r.chart).toMatchObject({ type: "bar", series: ["value"], data: [{ x: "Benzin", value: 1665 }, { x: "El", value: 17778 }] });

    expect(r.trace.tool_calls).toBe(3);
    expect(r.trace.model).toBe("claude-haiku-5-5");
    expect(r.trace.usage).toEqual({ input_tokens: 4000, output_tokens: 400, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0 });
    expect(r.trace.cost_usd).toBeCloseTo((4000 * 0.1 + 400 * 0.5 + 8000 * 0.01) / 1e6, 10);
    expect(r.trace.steps[0]!.reason).toBe("Finder tabeller om nyregistrerede biler.");

    expect(events.map((e) => e.type)).toEqual(["start", "llm", "tool_call", "tool_result", "llm", "tool_call", "tool_result", "llm", "tool_call", "tool_result", "llm", "tool_call", "tool_result", "final"]);
    expect(requests[0]!.tools!.map((t) => (t as Anthropic.Tool).name)).toEqual(["search_tables", "get_table_info", "get_data", "submit_answer"]);
    expect(requests[0]!.cache_control).toEqual({ type: "ephemeral" });
  });

  it("returns tool input errors to the model so it can correct itself", async () => {
    const { client, requests } = fakeClient([
      [use("get_data", { table_id: "BIL51", variables: [{ code: "DRIV", values: ["benz"] }] })],
      [use("submit_answer", { status: "not_found", answer: "Kunne ikke finde data." })],
    ]);
    const r = await runAgent("Benzinbiler?", { tools: replayTools(), client });
    const toolResult = (requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(toolResult).toMatchObject({ is_error: true });
    expect(String(toolResult.content)).toMatch(/Did you mean: 20205 \(Benzin\)/);
    expect(r.trace.steps[0]!.ok).toBe(false);
    expect(r.status).toBe("not_found");
  });

  it("rejects numbers that are not in the fetched data", async () => {
    const { client, requests } = fakeClient([
      [use("get_data", bil51Query)],
      (body) => [use("submit_answer", { status: "answered", answer: "20.000 elbiler.", values: [{ label: "El", value: 20000 }], result_ids: [lastResultId(body)] })],
      (body) => {
        const prev = body.messages.at(-3)!.content as Anthropic.ToolResultBlockParam[];
        const id = JSON.parse(String(prev[0]!.content)).result_id;
        return [use("submit_answer", { status: "answered", answer: "17.778 elbiler.", values: [{ label: "El", value: 17778 }], result_ids: [id] })];
      },
    ]);
    const r = await runAgent("Elbiler i september 2026?", { tools: replayTools(), client });
    const rejection = (requests[2]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(String(rejection.content)).toMatch(/Value 20000 \(El\) is not in the referenced results/);
    expect(r.status).toBe("answered");
    expect(r.values[0]!.value).toBe(17778);
  });

  it("accepts computed values only with a calculation", async () => {
    const { client } = fakeClient([
      [use("get_data", bil51Query)],
      (body) => [
        use("submit_answer", {
          status: "answered",
          answer: "Elbiler udgjorde 91,4 %.",
          values: [{ label: "Andel el", value: 91.4, computed: true }],
          calculation: "17778 / (17778 + 1665) = 91.4%",
          result_ids: [lastResultId(body)],
        }),
      ],
    ]);
    const r = await runAgent("Andel elbiler?", { tools: replayTools(), client });
    expect(r).toMatchObject({ status: "answered", calculation: "17778 / (17778 + 1665) = 91.4%" });
  });

  it("nudges once when the model ends without submit_answer, then fails clearly", async () => {
    const { client, requests } = fakeClient([[say("Her er svaret.")], [say("Stadig intet.")]]);
    const r = await runAgent("Hvor mange bor i Danmark?", { tools: replayTools(), client });
    expect(requests[1]!.messages.at(-1)).toEqual({ role: "user", content: "Finish by calling submit_answer." });
    expect(r).toMatchObject({ status: "failed", failure: { reason: "no_answer" } });
    expect(r.answer).toMatch(/^Kunne ikke finde et svar/);
  });

  it("stops at max steps", async () => {
    const loop = [use("search_tables", { query: "biler" })];
    const { client } = fakeClient([loop, loop, loop]);
    const r = await runAgent("How many cars?", { tools: replayTools(), client, maxSteps: 2 });
    expect(r).toMatchObject({ status: "failed", failure: { reason: "max_steps" } });
    expect(r.answer).toMatch(/^Could not find an answer/);
  });

  it("times out via the abort signal", async () => {
    const client: MessagesClient = {
      messages: {
        create: (_body, opts) =>
          new Promise((_resolve, reject) => opts?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      },
    };
    const r = await runAgent("Slow?", { tools: replayTools(), client, timeoutMs: 50 });
    expect(r).toMatchObject({ status: "failed", failure: { reason: "timeout" } });
  });

  it("reports API errors without throwing", async () => {
    const client: MessagesClient = { messages: { create: async () => Promise.reject(new Error("boom")) } };
    const r = await runAgent("x", { tools: replayTools(), client });
    expect(r).toMatchObject({ status: "failed", failure: { reason: "api_error", message: "boom" } });
  });
});
