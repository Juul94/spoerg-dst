# ADR 0003: Eval strategy

Status: accepted

## Context

"It answered my demo question" is not evidence. The agent can fail in ways that look fine: the wrong table with a plausible number, the right table with the wrong period, or a confident answer where no data exists. Evals have to catch these, and they must be cheap enough to run often on a small budget.

## Decision

Two layers.

### 1. Offline retrieval benchmark (free, deterministic)

- `npm run eval:retrieval` scores `search_tables` against the recorded table list, with no API calls. It reports recall@1/3/5/10 and MRR.
- It uses 40 tuning queries plus 14 holdout queries. The holdout queries were written before tuning and never used to choose a change.
- It runs in CI on every push.

### 2. End-to-end agent eval (paid, live API)

`evals/dataset.json` holds 36 cases: 13 lookup, 8 time comparison, 6 calculation, 4 ambiguous and 5 no-data.

- **Each answerable case is verified against the live API.** `npm run eval:verify` stores the table ID and the exact query, so the expected answer can be reproduced and re-checked when StatBank revises data.
- **Expected answers are numbers with a tolerance.** Ambiguous questions list several acceptable interpretations and tables.

Scoring per case:

- correct answer (any expected value within tolerance)
- correct table (a cited source is an accepted table)
- correct refusal (for no-data cases)
- tool calls, tokens, cost and latency

Mechanics:

- `npm run eval` prints a table and saves one JSON file per run. `npm run eval:compare` diffs runs, so models or prompt versions can be compared on the same cases.
- A cost estimate is shown before every run and needs `--yes`. A full run is about $0.12 on Haiku and about $2.3 on Sonnet.
- A 7-case `ci` subset runs on pull requests with Haiku (about $0.02).

## Consequences

- Retrieval can be iterated freely. LLM runs are reserved for decisions such as choosing the model or prompt.
- Live data changes. Verified references make drift visible instead of silently failing.
- 36 cases are too few for small differences. A difference of one or two cases between models is noise, and the reports say so.
- Scoring is programmatic (numbers, table IDs, status), with no LLM-as-judge. That is cheaper and reproducible, but the eval does not check prose quality.
