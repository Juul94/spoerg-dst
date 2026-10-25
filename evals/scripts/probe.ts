// Dev helper for writing the dataset: `npm run probe -- search "query"`, `info ID`, `data ID '[{"code":"Tid","values":["(3)"]}]' [lang]`.
import { StatbankClient, StatbankTools, GetDataInput } from "statbank-mcp";

const tools = new StatbankTools(new StatbankClient());
const [cmd, a, b, lang = "da"] = process.argv.slice(2);
const out =
  cmd === "search"
    ? (await tools.searchTables({ query: a!, limit: 8, include_inactive: false, lang: lang as "da" })).results.map((r) => `${r.id} ${r.period} | ${r.title} | ${r.variables.join(",")}`)
    : cmd === "info"
      ? await tools.getTableInfo({ table_id: a!, max_values: Number(b ?? 15), lang: lang as "da" })
      : await tools.getData(GetDataInput.parse({ table_id: a, variables: JSON.parse(b ?? "[]"), lang, max_rows: 60 }));
console.log(JSON.stringify(out, null, 1));
