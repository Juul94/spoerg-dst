// Compares saved runs side by side: `npm run eval:compare -- results/a.json results/b.json`.
// Without arguments it compares the latest run per model+prompt.
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { printSummary } from "./report.js";
import type { Summary } from "./scoring.js";

const dir = fileURLToPath(new URL("../results", import.meta.url));
type Saved = { run: { model: string; prompt: string; subset: string | null }; summary: Summary };

let files = process.argv.slice(2).map((f) => resolve(f));
if (!files.length) {
  const latest = new Map<string, string>();
  for (const f of (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()) {
    const saved = JSON.parse(await readFile(join(dir, f), "utf8")) as Saved;
    latest.set(`${saved.run.model} ${saved.run.prompt} ${saved.run.subset ?? "all"}`, join(dir, f));
  }
  files = [...latest.values()];
}
if (!files.length) {
  console.error("No results yet. Run `npm run eval` first.");
  process.exit(2);
}
const runs = await Promise.all(
  files.map(async (f) => {
    const saved = JSON.parse(await readFile(f, "utf8")) as Saved;
    return { name: `${saved.run.model.replace("claude-", "")} ${saved.run.prompt}${saved.run.subset ? ` [${saved.run.subset}]` : ""}`, summary: saved.summary, file: basename(f) };
  }),
);
printSummary(runs);
console.log(`\n${runs.map((r) => `${r.name}: ${r.file}`).join("\n")}`);
