# ADR 0002: Context management for large tables

Status: accepted

## Context

StatBank tables can be huge. Population by municipality × age × sex × quarter is millions of cells. Their metadata can list thousands of value codes, and there are about 2,000 parish codes. Putting this into the context window is slow, costly, and makes answers worse.

## Decision

- **Metadata is summarised.** `get_table_info` caps each value list at `max_values`. Time keeps the first period plus the newest periods, so the model sees both the coverage and what is latest. A note says how many values were left out and how to find them (`value_search`).
- **Selections are bounded before fetching.** `get_data` multiplies the resolved value counts. Above 20,000 cells it refuses, and the error lists each variable's count, so the model can narrow the selection.
- **Omitted variables collapse to totals.** An omitted eliminable variable returns its total. An omitted time variable returns the latest period. The default query is therefore one small number.
- **Responses are capped, results are not.** `get_data` returns at most `max_rows` rows (default 200), plus `row_count`, `truncated`, and a summary (min/max/sum/nulls). The full result is kept server-side under its `result_id`, so charts are built from all rows without sending them through the model.
- **Tool results in agent events are previews.** Traces and the UI get a 400-character preview, not the payload.
- **Caching.** The table list and the table metadata are cached in memory with a TTL, and StatBank calls are rate-limited. A web server process shares one client across requests.

## Consequences

- A typical answer uses a few thousand tokens of tool output instead of tens of thousands.
- The model can still analyse large results, but it has to ask for them on purpose. Computing over truncated rows is a known risk; the `summary` field covers the common totals.
- The server-side result store is per process, so charts only work within the run that fetched the data. That is fine for this app.
