import "server-only";
import { resolve } from "node:path";
import { clientOptionsFromEnv, StatbankClient, StatbankTools } from "statbank-mcp";
import { WindowLimiter } from "./rate-limit";

// Next only reads .env from apps/web; the monorepo keeps one .env at the root.
try {
  process.loadEnvFile(resolve(process.cwd(), "../../.env"));
} catch {
  // no root .env: rely on the environment
}

const g = globalThis as typeof globalThis & { __statbankTools?: StatbankTools; __askLimiter?: WindowLimiter };

/** One client per server process, so the metadata cache and StatBank rate limiter are shared across requests. */
export function statbankTools(): StatbankTools {
  g.__statbankTools ??= new StatbankTools(new StatbankClient(clientOptionsFromEnv()));
  return g.__statbankTools;
}

export function askLimiter(): WindowLimiter {
  const limit = Number(process.env.WEB_RATE_LIMIT ?? 5);
  g.__askLimiter ??= new WindowLimiter(limit, 10 * 60_000);
  return g.__askLimiter;
}

export const MAX_QUESTION_CHARS = 300;
