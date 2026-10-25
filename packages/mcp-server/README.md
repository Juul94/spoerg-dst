# statbank-mcp

An MCP server for [Statistics Denmark's StatBank API](https://www.dst.dk/en/Statistik/brug-statistikken/muligheder-i-statistikbanken/api) (api.statbank.dk). It needs no API key.

It provides three read-only tools that let an LLM find a table, check its metadata, and fetch exactly the cells it needs:

| Tool | What it does |
|---|---|
| `search_tables` | Ranked local search over all ~2,300 tables (Danish + English titles, variable names, æøå folding, typo-tolerant). |
| `get_table_info` | Variables and value codes for a table. Long lists are trimmed (time variables show the newest periods), and `value_search` finds codes inside large lists such as municipalities. |
| `get_data` | Validates codes locally (with "did you mean" suggestions), enforces a cell limit before calling the API, and returns compact rows with labels, a summary, and a reproducible `source.api_query`. |

## Use with Claude Code

```bash
claude mcp add statbank -- npx -y statbank-mcp
```

## Use with Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "statbank": { "command": "npx", "args": ["-y", "statbank-mcp"] }
  }
}
```

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `STATBANK_MODE` | `live` | `live`, `record` (save responses as fixtures) or `replay` (offline, fixtures only) |
| `STATBANK_FIXTURES_DIR` | `./fixtures` | Fixture location for record/replay |
| `STATBANK_TIMEOUT_MS` | `20000` | Per-request timeout |

## Development

```bash
npm test          # unit tests (mocked fetch + recorded fixtures, no network)
npm run build
npm run inspect   # MCP Inspector
npm run record    # re-record fixtures from the live API
```

The client has timeouts, retries with backoff on 429/5xx/network errors, a concurrency- and interval-based rate limiter, in-flight de-duplication, and a TTL cache (metadata 6h, data 10m). Every response is validated with Zod.

MIT licensed.
