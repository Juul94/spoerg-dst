import { fileURLToPath } from "node:url";
import { StatbankClient } from "../src/statbank/client.js";
import { StatbankTools } from "../src/tools.js";

export const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));

/** Tools backed by recorded fixtures: offline and deterministic. */
export function replayTools() {
  return new StatbankTools(new StatbankClient({ mode: "replay", fixturesDir }));
}

/** A fetch mock that returns queued responses and records requests. */
export function mockFetch(responses: Array<{ status: number; body: unknown } | Error>) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const next = responses.shift();
    if (!next) throw new Error("mockFetch: no more responses");
    if (next instanceof Error) throw next;
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return new Response(text, { status: next.status });
  };
  return { fetch: impl as typeof fetch, calls };
}
