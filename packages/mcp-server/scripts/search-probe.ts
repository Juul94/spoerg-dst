/** Dev helper: prints top search hits per query. npx tsx scripts/search-probe.ts "elbiler" "ledighed" */
import { StatbankClient, StatbankTools } from "../src/index.js";
const t = new StatbankTools(new StatbankClient());
for (const q of process.argv.slice(2)) {
  const r = await t.searchTables({ query: q, limit: 5, include_inactive: false, lang: "da" });
  console.log("##", q); for (const h of r.results) console.log(" ", h.id, h.score, h.title, h.period);
}
