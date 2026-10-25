/** USD per 1M tokens. Cache write = 5-minute TTL. Haiku prices apply to prompts ≤100K tokens (always true here). */
export const PRICES: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};

export const MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
  opus: "claude-opus-5-5",
};

export const resolveModel = (m: string) => MODEL_ALIASES[m] ?? m;

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export const emptyUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

export function addUsage(total: Usage, u: Partial<Record<keyof Usage, number | null>>): Usage {
  for (const k of Object.keys(total) as Array<keyof Usage>) total[k] += u[k] ?? 0;
  return total;
}

/** Cost in USD, or null for models without a price entry. */
export function costUsd(model: string, u: Usage): number | null {
  const p = PRICES[model];
  if (!p) return null;
  const c = u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_input_tokens * p.cacheRead + u.cache_creation_input_tokens * p.cacheWrite;
  return c / 1e6;
}
