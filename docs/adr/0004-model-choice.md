# ADR 0004: Model choice from eval data

Status: proposed. The decision rule is fixed, but the numbers are pending.

## Context

The agent runs on any Claude model. Sonnet 5.5 is the default. Haiku 5.5 costs roughly 20× less per token (input $0.10 vs $2 per 1M tokens) and was used during development. The choice should come from the eval, not from intuition.

## Decision rule

1. Run the full eval on both models with the same prompt version:

   ```bash
   npm run eval -- --model haiku --yes
   npm run eval -- --model sonnet --yes
   npm run eval:compare
   ```

2. **Use Haiku if both of these hold:**
   - its accuracy is within 2 cases of Sonnet's overall
   - it is not worse on refusals (no-data cases), because a confident wrong answer is the worst failure for a statistics tool
3. **Otherwise use Sonnet**, and report cost per correct answer, not cost per question.
4. Re-run when the prompt version, the tool descriptions or the model lineup changes.

## Status of the data

No end-to-end LLM runs have been recorded yet; the project was built without an API key available. Reported so far:

- Offline retrieval: measured. See `docs/improvements.md`.
- Model comparison: not measured. This ADR will be updated with the results table from `evals/results/`.

Until then, the default stays `claude-sonnet-5-5`. That is the conservative choice for correctness. Development and CI use Haiku for cost.
