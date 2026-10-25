import type { NextConfig } from "next";

const config: NextConfig = {
  // The agent and StatBank client are server-only Node code; keep them out of the bundler.
  serverExternalPackages: ["@spoerg-dst/agent", "statbank-mcp", "@anthropic-ai/sdk"],
};

export default config;
