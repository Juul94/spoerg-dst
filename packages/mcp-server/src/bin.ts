#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";
import { clientOptionsFromEnv } from "./env.js";

const { server } = createServer(clientOptionsFromEnv());
await server.connect(new StdioServerTransport());
// stdout is the protocol channel; log to stderr only
console.error("statbank-mcp running on stdio");
