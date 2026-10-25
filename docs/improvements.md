# Eval-driven improvements (Phase 4)

Every change below was measured before and after. Raw results live in `evals/results/`.

## 1. Table search (`search_tables`)

The agent can only answer if `search_tables` puts the right table near the top. This is measured offline with `npm run eval:retrieval`. That command runs 40 tuning queries plus 14 holdout queries against the recorded table list of 5,742 tables. It makes no API calls and costs nothing.

The holdout queries were written before tuning. They were never used to choose a change, so they show whether a change generalises or only fits the tuning queries.

| Step | Tuning R@1 | Tuning R@5 | Tuning MRR | Holdout R@1 | Holdout MRR |
|---|---|---|---|---|---|
| Baseline (token, prefix and trigram match with IDF) | 0.38 | 0.50 | 0.427 | 0.79 | 0.821 |
| + light stemming, synonyms, title-length and staleness priors | 0.45 | 0.75 | 0.568 | 0.93 | 0.937 |
| + curated headline-table prior, `growth → vækst` | **0.85** | **0.93** | **0.894** | **1.00** | **1.000** |

Files: `retrieval_baseline.json`, `retrieval_step1-stem-synonyms-priors.json`, `retrieval_step2-headline-prior.json`.

### What the failures showed

- **Inflected forms missed exact matches.** "befolkning" matched "befolkningen" only as a prefix, which scores lower than an exact hit, so niche tables containing the exact word won. Light suffix stripping fixed this.
- **Users don't use StatBank's vocabulary.** People write "arbejdsløshed", "huspriser", "inflation" and "elbiler". The table titles say "Fuldtidsledige", "Prisindeks for ejendomssalg", "Forbrugerprisindeks" and "Nyregistrerede personbiler" plus a fuel variable. A list of about 30 synonyms closes most of the gap.
- **Generic words match hundreds of tables.** About 200 tables mention population. Without usage data, nothing separates FOLK1A from a parish-level table with the same title.

### Tradeoffs

- **The headline prior is a deliberate bias.** It is a curated list of 19 key-figure tables. Its job is to fix the tuning queries, so the tuning gain from step 2 overstates what users will see.
  - The holdout set is the honest check: none of its target tables are on the list, and it did not get worse.
  - One holdout table (SKI6) had been added to the list by mistake. It was caught and removed before the step 2 numbers were recorded.
  - Niche tables still win when the query names them (see `test/search.test.ts`).
- **Stemming is crude** (suffix stripping, no dictionary). It is cheap and deterministic, and the trigram match still catches compound words.
- **Known misses after tuning:**
  - "indbyggere Aarhus" (the municipality name matches regional tables)
  - "ledighed procent" and "unemployment rate" (many unemployment tables; KUBESK11 matches "unemployment rate" literally)

## 2. System prompt v2

`packages/agent/src/prompts.ts` adds `v2` on top of `v1`. It targets the failure modes found while building the eval set:

- search with short Danish StatBank keywords
- check the table's latest period before fetching
- state the chosen reading of an ambiguous question in `assumptions`
- show derived numbers in `calculation`
- refuse future or unpublished periods instead of substituting another period

**Status: not yet measured with an LLM.** No API key was available while building this. The comparison is one command:

```bash
npm run eval -- --model haiku --prompt v1 --yes   # ~$0.12
npm run eval -- --model haiku --prompt v2 --yes   # ~$0.12
npm run eval:compare
```

`v1` stays the default until a run shows that `v2` is better. No LLM numbers are reported here until they come from real runs.
