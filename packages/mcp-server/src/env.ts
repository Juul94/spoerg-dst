import type { ClientMode, StatbankClientOptions } from "./statbank/client.js";

/** STATBANK_MODE=live|record|replay, STATBANK_FIXTURES_DIR, STATBANK_TIMEOUT_MS */
export function clientOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): StatbankClientOptions {
  const mode = (env.STATBANK_MODE ?? "live") as ClientMode;
  if (!["live", "record", "replay"].includes(mode)) throw new Error(`Invalid STATBANK_MODE: ${mode}`);
  return {
    mode,
    ...(env.STATBANK_FIXTURES_DIR ? { fixturesDir: env.STATBANK_FIXTURES_DIR } : {}),
    ...(env.STATBANK_TIMEOUT_MS ? { timeoutMs: Number(env.STATBANK_TIMEOUT_MS) } : {}),
  };
}
