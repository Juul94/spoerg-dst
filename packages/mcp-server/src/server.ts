import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StatbankClient, type StatbankClientOptions } from "./statbank/client.js";
import { StatbankTools, ToolInputError, createToolDefs } from "./tools.js";

export const SERVER_NAME = "statbank-mcp";
export const SERVER_VERSION = "0.1.0";

/** Builds an MCP server exposing search_tables, get_table_info and get_data. Transport is chosen by the caller. */
export function createServer(opts: StatbankClientOptions = {}) {
  const tools = new StatbankTools(new StatbankClient(opts));
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Tools for Statistics Denmark's StatBank. Typical flow: search_tables -> get_table_info -> get_data. Always cite the table id and the selected variables. If no table fits, say so instead of guessing.",
    },
  );

  for (const def of createToolDefs(tools)) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.inputSchema.shape,
        outputSchema: def.outputSchema.shape,
        annotations: def.annotations,
      },
      async (args: Record<string, unknown>) => {
        try {
          const input = def.inputSchema.parse(args);
          const output = def.outputSchema.parse(await def.handler(input));
          return { content: [{ type: "text" as const, text: JSON.stringify(output) }], structuredContent: output };
        } catch (err) {
          const message = err instanceof ToolInputError ? err.message : `Internal error: ${(err as Error).message}`;
          return { content: [{ type: "text" as const, text: message }], isError: true };
        }
      },
    );
  }
  return { server, tools };
}
