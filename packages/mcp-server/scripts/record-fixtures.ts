/**
 * Records live StatBank responses used by the unit tests into fixtures/.
 * Run: npm run record-fixtures (from repo root). Re-run when the API or tests change.
 */
import { fileURLToPath } from "node:url";
import { StatbankClient } from "../src/statbank/client.js";
import { StatbankTools } from "../src/tools.js";

const fixturesDir = fileURLToPath(new URL("../fixtures", import.meta.url));
const tools = new StatbankTools(new StatbankClient({ mode: "record", fixturesDir }));

await tools.searchTables({ query: "nyregistrerede personbiler drivmiddel", limit: 5, include_inactive: false, lang: "da" });
await tools.getTableInfo({ table_id: "BIL51", max_values: 25, lang: "da" });
await tools.getTableInfo({ table_id: "FOLK1A", max_values: 25, lang: "da" });
await tools.getTableInfo({ table_id: "FOLK1A", max_values: 25, lang: "en" });
await tools.getData({ table_id: "BIL51", variables: [{ code: "DRIV", values: ["20225"] }, { code: "Tid", values: ["2025M*"] }], max_rows: 200, lang: "da" });
await tools.getData({ table_id: "BIL51", variables: [{ code: "DRIV", values: ["20225", "20205"] }, { code: "Tid", values: ["2026M09"] }], max_rows: 200, lang: "da" });
await tools.getData({ table_id: "FOLK1A", variables: [{ code: "Tid", values: ["2026K3"] }], max_rows: 200, lang: "da" });
await tools.getData({ table_id: "FOLK1A", variables: [{ code: "Tid", values: ["2026Q3"] }], max_rows: 200, lang: "en" });
await tools.getTableInfo({ table_id: "NOPE999", max_values: 25, lang: "da" }).catch((e) => console.log("expected error:", e.message));
console.log("fixtures recorded in", fixturesDir);
