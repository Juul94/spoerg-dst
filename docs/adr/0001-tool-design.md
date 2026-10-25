# ADR 0001: Three coarse tools mirroring the StatBank workflow

Status: accepted

## Context

StatBank exposes four endpoints: subjects, tables, tableinfo and data. Answering a question takes three steps: find a table, learn its variable codes, then fetch a selection. Models are good at following a short, explicit workflow. They are bad at guessing value codes such as `OMRÅDE=751` or `Tid=2025M03`.

## Decision

Expose three tools: `search_tables`, `get_table_info` and `get_data`. Each one is defined once in `packages/mcp-server/src/tools.ts`, with its name, description, Zod input and output schemas, and handler. The MCP server and the agent both use these definitions, so they cannot drift apart.

- **`search_tables` runs a local ranked search** over the full table list (5,742 tables in da + en), fetched once and cached. It does not call the API's subject tree. The search uses stemming, synonyms and priors; see ADR 0004 and `docs/improvements.md`.
- **`get_table_info` returns compact metadata.** Value lists are truncated, and time keeps the first period plus the newest periods. A `value_search` parameter resolves names to codes, for example "Aarhus" → `751`.
- **`get_data` validates the selection before calling the API.** It checks unknown codes, missing non-eliminable variables, and the cell limit (`MAX_CELLS` = 20,000).
  - Errors explain how to fix the call and are returned to the model as a tool result. They are not thrown.
  - It accepts the API's own selectors (`*`, `(3)`, ranges, prefix wildcards), so the model needs no new syntax.
- **Each `get_data` result gets a `result_id`.** The final `submit_answer` tool must cite result IDs. That makes sources and charts traceable to real fetches, not to numbers the model makes up.

## Consequences

- Three round trips is the minimum per answer. Latency is dominated by LLM calls, not by StatBank.
- Errors that tell the model how to fix the call let it self-correct. This was cheaper than adding a planner.
- A local search index means search quality is our responsibility. That is good, because it is measurable offline at zero cost.
- **Rejected alternative: one `ask_statbank(question)` tool.** It hides the reasoning and can't be evaluated per step.
- **Rejected alternative: exposing the raw endpoints.** That would push code syntax and limits onto the model.
