import type Anthropic from "@anthropic-ai/sdk";
import type { MessagesClient } from "./agent.js";

/**
 * Demo mode: a scripted stand-in for Claude, so the app runs without an API key.
 * The agent loop, tool validation and StatBank calls are all real; only the decisions
 * (which tool to call, with which input) are hard-coded per example question.
 */
export const DEMO_MODEL = "demo-scripted";

type Json = any; // tool results are parsed JSON; scripts read the fields they asked for
type Turn = (prev: Json[]) => { text: string; tool: string; input: Record<string, unknown> };

const latest = (r: Json) => r.rows.at(-1).at(-1) as number;
const fmt = (n: number, lang: "da" | "en") => n.toLocaleString(lang === "da" ? "da-DK" : "en-GB");

const search = (query: string, lang = "da"): Turn => () => ({
  text: `Searching StatBank for "${query}".`,
  tool: "search_tables",
  input: { query, limit: 5, lang },
});
const info = (table_id: string, lang = "da"): Turn => () => ({
  text: `Reading ${table_id} metadata to get valid variable codes and the latest period.`,
  tool: "get_table_info",
  input: { table_id, lang },
});

const SCRIPTS: Record<string, Turn[]> = {
  "Hvor mange bor der i Danmark?": [
    search("befolkning"),
    info("FOLK1A"),
    () => ({
      text: "All variables except time are eliminable, so omitting them gives the national total for the latest quarter.",
      tool: "get_data",
      input: { table_id: "FOLK1A", variables: [], lang: "da" },
    }),
    ([r]) => ({
      text: "",
      tool: "submit_answer",
      input: {
        status: "answered",
        answer: `Der bor ${fmt(latest(r), "da")} personer i Danmark (seneste kvartal i FOLK1A).`,
        values: [{ label: "Befolkning", value: latest(r), unit: "personer", computed: false }],
        result_ids: [r.result_id],
      },
    }),
  ],

  "Hvordan har befolkningstallet udviklet sig siden 2015?": [
    search("befolkning kvartal"),
    info("FOLK1A"),
    () => ({
      text: "Fetching every quarter from 2015K1 with a range selector.",
      tool: "get_data",
      input: { table_id: "FOLK1A", variables: [{ code: "Tid", values: [">=2015K1"] }], lang: "da" },
    }),
    ([r]) => {
      const first = r.rows[0] as [string, number];
      const last = r.rows.at(-1) as [string, number];
      const pct = Math.round(((last[1] - first[1]) / first[1]) * 1000) / 10;
      return {
        text: "",
        tool: "submit_answer",
        input: {
          status: "answered",
          answer: `Befolkningen er vokset fra ${fmt(first[1], "da")} i ${first[0]} til ${fmt(last[1], "da")} i ${last[0]}, en stigning på ${fmt(pct, "da")} %.`,
          values: [
            { label: "Befolkning", value: first[1], period: first[0], computed: false },
            { label: "Befolkning", value: last[1], period: last[0], computed: false },
            { label: "Vækst", value: pct, unit: "%", computed: true },
          ],
          calculation: `(${last[1]} - ${first[1]}) / ${first[1]} = ${pct} %`,
          result_ids: [r.result_id],
          chart: { result_id: r.result_id, type: "line", title: "Befolkningen 1. i kvartalet" },
        },
      };
    },
  ],

  "Hvor mange elbiler blev nyregistreret i 2025?": [
    search("elbiler"),
    info("BIL51"),
    () => ({
      text: "DRIV=20225 is electric. Fetching all months of 2025 with a prefix wildcard.",
      tool: "get_data",
      input: { table_id: "BIL51", variables: [{ code: "DRIV", values: ["20225"] }, { code: "Tid", values: ["2025M*"] }], lang: "da" },
    }),
    ([r]) => ({
      text: "",
      tool: "submit_answer",
      input: {
        status: "answered",
        answer: `Der blev nyregistreret ${fmt(r.summary.sum, "da")} elbiler i 2025 (summen af ${r.row_count} måneder).`,
        values: [{ label: "Nye elbiler 2025", value: r.summary.sum, unit: "stk.", computed: true }],
        calculation: `Sum af ${r.row_count} måneder (2025M01–2025M12) = ${r.summary.sum}`,
        result_ids: [r.result_id],
        chart: { result_id: r.result_id, type: "bar", title: "Nyregistrerede elbiler pr. måned, 2025" },
      },
    }),
  ],

  "How many people live in Aarhus municipality?": [
    search("population municipality", "en"),
    () => ({
      text: "Looking up the municipality code for Aarhus.",
      tool: "get_table_info",
      input: { table_id: "FOLK1A", lang: "en", value_search: { variable: "OMRÅDE", query: "Aarhus" } },
    }),
    () => ({
      text: "OMRÅDE=751 is Aarhus. Other variables collapse to totals; time defaults to the latest quarter.",
      tool: "get_data",
      input: { table_id: "FOLK1A", variables: [{ code: "OMRÅDE", values: ["751"] }], lang: "en" },
    }),
    ([r]) => ({
      text: "",
      tool: "submit_answer",
      input: {
        status: "answered",
        answer: `${fmt(latest(r), "en")} people live in Aarhus municipality (latest quarter in FOLK1A).`,
        values: [{ label: "Population, Aarhus", value: latest(r), unit: "persons", computed: false }],
        result_ids: [r.result_id],
      },
    }),
  ],

  "Hvor mange katte er der i Danmark?": [
    search("katte"),
    ([r]) => ({
      text: "",
      tool: "submit_answer",
      input: {
        status: "not_found",
        answer: `Kunne ikke finde data om katte. Søgningen gav kun tabeller uden relation til kæledyr (${r.results
          .slice(0, 3)
          .map((h: Json) => h.id)
          .join(", ")}), og Statistikbanken har ingen opgørelse over kæledyr.`,
      },
    }),
  ],
};

export const DEMO_QUESTIONS = Object.keys(SCRIPTS);

const normalize = (q: string) => q.trim().toLowerCase().replace(/\s+/g, " ");

/** A MessagesClient that replays the script for a demo question, or null if the question has none. */
export function demoClient(question: string): MessagesClient | null {
  const turns = Object.entries(SCRIPTS).find(([q]) => normalize(q) === normalize(question))?.[1];
  if (!turns) return null;
  let n = 0;
  return {
    messages: {
      async create(body) {
        const last = body.messages.at(-1);
        const prev = Array.isArray(last?.content)
          ? last.content.flatMap((b) => (b.type === "tool_result" && typeof b.content === "string" ? [JSON.parse(b.content) as Json] : []))
          : [];
        const turn = turns[Math.min(n, turns.length - 1)]!;
        n++;
        const { text, tool, input } = turn(prev);
        const content = [
          ...(text ? [{ type: "text", text, citations: null }] : []),
          { type: "tool_use", id: `demo_${n}`, name: tool, input },
        ];
        return {
          id: `demo_msg_${n}`,
          type: "message",
          role: "assistant",
          model: DEMO_MODEL,
          content,
          stop_reason: "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        } as unknown as Anthropic.Message;
      },
    },
  };
}
