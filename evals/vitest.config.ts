import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Run against package sources so tests don't depend on a prior build.
export default defineConfig({
  resolve: {
    alias: {
      "statbank-mcp": fileURLToPath(new URL("../packages/mcp-server/src/index.ts", import.meta.url)),
      "@spoerg-dst/agent": fileURLToPath(new URL("../packages/agent/src/index.ts", import.meta.url)),
    },
  },
  test: { include: ["test/**/*.test.ts"] },
});
