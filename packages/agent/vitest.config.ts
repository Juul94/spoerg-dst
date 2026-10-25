import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Run against mcp-server sources so tests don't depend on a prior build.
export default defineConfig({
  resolve: { alias: { "statbank-mcp": fileURLToPath(new URL("../mcp-server/src/index.ts", import.meta.url)) } },
  test: { include: ["test/**/*.test.ts"], testTimeout: 20_000 },
});
