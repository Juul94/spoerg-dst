// Offline retrieval benchmark for search_tables: does the right table rank in the top k?
// Uses the recorded table list (replay mode), so it is free and deterministic.
// npm run eval:retrieval -- [--label baseline] [--verbose]
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { StatbankClient, TableIndex } from "statbank-mcp";

/** Keyword queries an agent typically sends, with every table that would be an acceptable first pick. */
export const QUERIES: Array<{ q: string; expect: string[] }> = [
  { q: "befolkning", expect: ["FOLK1A", "BEF5", "FOLK3"] },
  { q: "befolkning kommune", expect: ["FOLK1A"] },
  { q: "folketal kvartal", expect: ["FOLK1A"] },
  { q: "population", expect: ["FOLK1A", "BEF5", "FOLK3"] },
  { q: "population municipality", expect: ["FOLK1A"] },
  { q: "indbyggere Aarhus", expect: ["FOLK1A"] },
  { q: "elbiler", expect: ["BIL51", "BIL10"] },
  { q: "nye elbiler", expect: ["BIL51"] },
  { q: "nyregistrerede personbiler drivmiddel", expect: ["BIL51"] },
  { q: "new electric cars", expect: ["BIL51"] },
  { q: "bestand personbiler", expect: ["BIL10"] },
  { q: "electric cars stock", expect: ["BIL10"] },
  { q: "overnatninger hoteller", expect: ["HOTEL1", "HOTEL7"] },
  { q: "hotel nights", expect: ["HOTEL1", "HOTEL7"] },
  { q: "turister overnatninger", expect: ["HOTEL1", "HOTEL7"] },
  { q: "døde", expect: ["DOD", "BEV3A", "BEV22"] },
  { q: "dødsfald", expect: ["DOD", "BEV3A", "BEV22"] },
  { q: "deaths", expect: ["DOD", "BEV3A", "BEV22"] },
  { q: "fødsler", expect: ["FOD", "BEV3A", "BEV22"] },
  { q: "births", expect: ["FOD", "BEV3A", "BEV22"] },
  { q: "inflation", expect: ["PRIS111", "PRIS01"] },
  { q: "forbrugerprisindeks", expect: ["PRIS111", "PRIS01"] },
  { q: "consumer price index", expect: ["PRIS111", "PRIS01"] },
  { q: "BNP vækst", expect: ["NAN1"] },
  { q: "GDP growth", expect: ["NAN1"] },
  { q: "vielser", expect: ["VIE7"] },
  { q: "marriages", expect: ["VIE7"] },
  { q: "arbejdsløshed", expect: ["AUS07", "AUS08", "AUS01"] },
  { q: "ledighed procent", expect: ["AUS07", "AUS08", "AUS01"] },
  { q: "bruttoledige", expect: ["AUS07", "AUS08", "AUS01"] },
  { q: "unemployment rate", expect: ["AUS07", "AUS08", "AUS01"] },
  { q: "middellevetid", expect: ["HISB7"] },
  { q: "life expectancy", expect: ["HISB7"] },
  { q: "indvandrere andel befolkning", expect: ["IEPCT"] },
  { q: "immigrants share population", expect: ["IEPCT"] },
  { q: "huspriser", expect: ["EJ56"] },
  { q: "boligpriser", expect: ["EJ56"] },
  { q: "house prices", expect: ["EJ56"] },
  { q: "BIL51", expect: ["BIL51"] },
  { q: "FOLK1A", expect: ["FOLK1A"] },
];

/** Written before tuning and never used to tune search. Reported separately to catch overfitting. */
export const HOLDOUT: typeof QUERIES = [
  { q: "skilsmisser", expect: ["SKI6", "SKI6KVT", "SKI125", "SKI225", "SKI125K"] },
  { q: "divorces", expect: ["SKI6", "SKI6KVT", "SKI125", "SKI225", "SKI125K"] },
  { q: "konkurser", expect: ["KONK3", "KONK5", "KONK6", "KONK7", "KONK8", "KONK9", "KONK25"] },
  { q: "bankruptcies", expect: ["KONK3", "KONK5", "KONK6", "KONK7", "KONK8", "KONK9", "KONK25"] },
  { q: "anmeldte forbrydelser", expect: ["STRAF10", "STRAF11", "STRAF20", "STRAF22", "STRAF24"] },
  { q: "reported crimes", expect: ["STRAF10", "STRAF11", "STRAF20", "STRAF22", "STRAF24"] },
  { q: "ledige stillinger", expect: ["LSK11", "LSK12", "LSK13", "LSK14", "LSK15", "LS01", "LS02"] },
  { q: "job vacancies", expect: ["LSK11", "LSK12", "LSK13", "LSK14", "LSK15", "LS01", "LS02"] },
  { q: "overnatninger campingpladser", expect: ["CAMP1"] },
  { q: "camping nights", expect: ["CAMP1"] },
  { q: "befolkning statsborgerskab", expect: ["FOLK1B", "FOLK1D"] },
  { q: "population citizenship", expect: ["FOLK1B", "FOLK1D"] },
  { q: "ledige kommune", expect: ["AUS08", "AULK01", "AUL01", "AUF02"] },
  { q: "nyregistrerede motorkøretøjer", expect: ["BIL5"] },
];

const KS = [1, 3, 5, 10] as const;

export function benchmark(index: TableIndex, queries = QUERIES) {
  const rows = queries.map(({ q, expect }) => {
    const hits = index.search(q, { limit: 10 }).map((h) => h.id);
    const rank = hits.findIndex((id) => expect.includes(id)) + 1; // 0 = miss
    return { q, expect, rank, top3: hits.slice(0, 3) };
  });
  const recall: Record<string, number> = Object.fromEntries(KS.map((k) => [`recall@${k}`, rows.filter((r) => r.rank > 0 && r.rank <= k).length / rows.length]));
  const mrr = rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / rows.length;
  return { queries: rows.length, recall, mrr, rows };
}

if (process.argv[1]?.endsWith("retrieval.ts")) {
  const { values: args } = parseArgs({ options: { label: { type: "string" }, verbose: { type: "boolean", default: false } } });
  const client = new StatbankClient({
    mode: "replay",
    fixturesDir: fileURLToPath(new URL("../../packages/mcp-server/fixtures", import.meta.url)),
  });
  const index = new TableIndex(await client.tables("da"), await client.tables("en"));
  const res = benchmark(index);
  const holdout = benchmark(index, HOLDOUT);
  for (const r of [...res.rows, ...holdout.rows]) {
    if (args.verbose || r.rank !== 1) console.log(`${r.rank === 1 ? "  ok " : r.rank ? `  #${r.rank}  ` : " MISS"} ${r.q.padEnd(40)} want ${r.expect.join("/").padEnd(22)} got ${r.top3.join(", ")}`);
  }
  const line = (name: string, b: typeof res) =>
    console.log(`${name.padEnd(8)} ${b.queries} queries · ${KS.map((k) => `R@${k} ${b.recall[`recall@${k}`]!.toFixed(2)}`).join(" · ")} · MRR ${b.mrr.toFixed(3)}`);
  console.log();
  line("tuning", res);
  line("holdout", holdout);
  if (args.label) {
    const dir = fileURLToPath(new URL("../results", import.meta.url));
    await mkdir(dir, { recursive: true });
    const file = join(dir, `retrieval_${args.label}.json`);
    await writeFile(file, JSON.stringify({ tuning: res, holdout }, null, 2));
    console.log(`Saved ${file}`);
  }
}
