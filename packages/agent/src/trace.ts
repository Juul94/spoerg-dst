import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentResult } from "./agent.js";

/** Writes the full run (answer + trace) as one JSON file per run. Returns the path. */
export async function writeTrace(dir: string, result: AgentResult): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${result.trace.started_at.replace(/[:.]/g, "-")}_${result.trace.run_id.slice(0, 8)}.json`);
  await writeFile(file, JSON.stringify(result, null, 2));
  return file;
}
