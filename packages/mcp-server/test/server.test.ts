import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { fixturesDir } from "./helpers.js";

async function connect() {
  const { server } = createServer({ mode: "replay", fixturesDir });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

describe("MCP server over the protocol", () => {
  it("lists the three tools with schemas and read-only annotations", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["get_data", "get_table_info", "search_tables"]);
    for (const t of tools) {
      expect(t.description!.length).toBeGreaterThan(80);
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema).toBeDefined();
      expect(t.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("returns structured content for a valid call", async () => {
    const client = await connect();
    const res = await client.callTool({
      name: "get_data",
      arguments: { table_id: "BIL51", variables: [{ code: "DRIV", values: ["20225", "20205"] }, { code: "Tid", values: ["2026M09"] }] },
    });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ table_id: "BIL51", rows: [["Benzin", 1665], ["El", 17778]] });
  });

  it("returns isError with an actionable message for bad input", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "get_data", arguments: { table_id: "BIL51", variables: [{ code: "DRIV", values: ["benz"] }] } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/Did you mean/);
  });
});
