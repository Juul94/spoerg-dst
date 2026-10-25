import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { RateLimiter, TtlCache, sleep, stableStringify } from "./infra.js";
import {
  ApiErrorBody,
  TableInfo,
  TableList,
  type DataRequestVariable,
  type DataRow,
  type Lang,
  type TableSummary,
} from "./schemas.js";

export type ClientMode = "live" | "record" | "replay";

export interface StatbankClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
  /** live: call the API. record: call the API and save responses as fixtures. replay: only read fixtures (offline, deterministic). */
  mode?: ClientMode;
  fixturesDir?: string;
  timeoutMs?: number;
  retries?: number;
  limiter?: RateLimiter;
  metadataTtlMs?: number;
  dataTtlMs?: number;
}

export class StatbankError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "StatbankError";
  }
  /** 4xx errors are caused by the request and should not be retried. */
  get retryable() {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}

interface RawResponse {
  status: number;
  body: string;
}

const Fixture = z.object({ endpoint: z.string(), request: z.unknown(), status: z.number(), body: z.string() });

export class StatbankClient {
  readonly mode: ClientMode;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly fixturesDir: string | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly limiter: RateLimiter;
  private readonly metadataTtlMs: number;
  private readonly dataTtlMs: number;
  private readonly cache = new TtlCache<unknown>(1000);
  private readonly inflight = new Map<string, Promise<unknown>>();
  /** Counts real HTTP calls (not cache hits). Useful in tests and traces. */
  httpCalls = 0;

  constructor(opts: StatbankClientOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? "https://api.statbank.dk/v1").replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.mode = opts.mode ?? "live";
    this.fixturesDir = opts.fixturesDir;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.retries = opts.retries ?? 2;
    this.limiter = opts.limiter ?? new RateLimiter();
    this.metadataTtlMs = opts.metadataTtlMs ?? 6 * 60 * 60 * 1000;
    this.dataTtlMs = opts.dataTtlMs ?? 10 * 60 * 1000;
    if (this.mode !== "live" && !this.fixturesDir) throw new Error(`fixturesDir is required in ${this.mode} mode`);
  }

  async tables(lang: Lang = "da"): Promise<TableSummary[]> {
    const body = { lang, format: "JSON", includeInactive: true };
    return this.cached(`tables:${lang}`, this.metadataTtlMs, async () => {
      const raw = await this.post("tables", body);
      return TableList.parse(JSON.parse(raw));
    });
  }

  async tableInfo(tableId: string, lang: Lang = "da"): Promise<TableInfo> {
    const id = tableId.toUpperCase();
    const body = { table: id, lang, format: "JSON" };
    return this.cached(`tableinfo:${lang}:${id}`, this.metadataTtlMs, async () => {
      const raw = await this.post("tableinfo", body);
      return TableInfo.parse(JSON.parse(raw));
    });
  }

  /** Fetches data with value codes (not labels), parsed into rows. Labels are joined from metadata by the caller. */
  async data(tableId: string, variables: DataRequestVariable[], lang: Lang = "da"): Promise<DataRow[]> {
    const body = { table: tableId.toUpperCase(), format: "CSV", valuePresentation: "Code", lang, variables };
    return this.cached(`data:${stableStringify(body)}`, this.dataTtlMs, async () => {
      const raw = await this.post("data", body);
      return parseCsv(raw, lang);
    });
  }

  private async cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit as T;
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;
    const p = load()
      .then((v) => {
        this.cache.set(key, v, ttl);
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  private async post(endpoint: string, body: Record<string, unknown>): Promise<string> {
    const res = this.mode === "replay" ? await this.readFixture(endpoint, body) : await this.fetchWithRetry(endpoint, body);
    if (this.mode === "record") await this.writeFixture(endpoint, body, res);
    if (res.status >= 400) throw toStatbankError(res);
    return res.body;
  }

  private async fetchWithRetry(endpoint: string, body: Record<string, unknown>): Promise<RawResponse> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await sleep(300 * 2 ** (attempt - 1) + Math.random() * 100);
      try {
        const res = await this.limiter.run(() => this.fetchOnce(endpoint, body));
        if (res.status === 429 || res.status >= 500) {
          lastErr = toStatbankError(res);
          continue;
        }
        return res;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr instanceof StatbankError) throw lastErr;
    throw new StatbankError(`StatBank request failed: ${String((lastErr as Error)?.message ?? lastErr)}`, "NETWORK");
  }

  private async fetchOnce(endpoint: string, body: Record<string, unknown>): Promise<RawResponse> {
    this.httpCalls++;
    const res = await this.fetchImpl(`${this.baseUrl}/${endpoint}`, {
      method: "POST",
      // explicit charset: without it Windows/curl-style clients can mangle Æ/Ø/Å in variable codes (REQUEST-EMPTY)
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    return { status: res.status, body: await res.text() };
  }

  private fixturePath(endpoint: string, body: unknown) {
    const hash = createHash("sha1").update(`${endpoint}:${stableStringify(body)}`).digest("hex").slice(0, 16);
    return join(this.fixturesDir!, endpoint, `${hash}.json`);
  }

  private async readFixture(endpoint: string, body: Record<string, unknown>): Promise<RawResponse> {
    const path = this.fixturePath(endpoint, body);
    let text: string;
    try {
      text = await readFile(path, "utf8");
    } catch {
      throw new StatbankError(`No recorded fixture for ${endpoint} ${stableStringify(body)} (${path}). Run in record mode.`, "FIXTURE-MISSING");
    }
    const f = Fixture.parse(JSON.parse(text));
    return { status: f.status, body: f.body };
  }

  private async writeFixture(endpoint: string, body: Record<string, unknown>, res: RawResponse) {
    const path = this.fixturePath(endpoint, body);
    await mkdir(join(this.fixturesDir!, endpoint), { recursive: true });
    await writeFile(path, JSON.stringify({ endpoint, request: body, status: res.status, body: sanitizeFixtureBody(endpoint, res.body) }, null, 1));
  }
}

/** Fixtures are committed: drop staff contact details (names, phones, emails) that tableinfo includes. */
function sanitizeFixtureBody(endpoint: string, body: string): string {
  if (endpoint !== "tableinfo") return body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    delete parsed.contacts;
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
}

function toStatbankError(res: RawResponse): StatbankError {
  try {
    const parsed = ApiErrorBody.parse(JSON.parse(res.body));
    return new StatbankError(parsed.message, parsed.errorTypeCode, res.status);
  } catch {
    return new StatbankError(`HTTP ${res.status}: ${res.body.slice(0, 200)}`, `HTTP-${res.status}`, res.status);
  }
}

/** Parses StatBank CSV (';'-separated, BOM, last column INDHOLD). Danish output uses decimal comma. */
export function parseCsv(text: string, lang: Lang): DataRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.length > 0);
  const header = lines.shift()?.split(";") ?? [];
  if (header.at(-1) !== "INDHOLD") throw new StatbankError(`Unexpected CSV header: ${header.join(";")}`, "PARSE");
  const keyCols = header.slice(0, -1);
  return lines.map((line) => {
    const cells = line.split(";");
    const keys: Record<string, string> = {};
    keyCols.forEach((col, i) => (keys[col] = cells[i] ?? ""));
    return { keys, value: parseNumber(cells.at(-1) ?? "", lang) };
  });
}

export function parseNumber(cell: string, lang: Lang): number | null {
  const s = cell.trim();
  if (s === "" || s === ".." || s === "..." || s === "-" || s === ":") return null;
  const normalized = lang === "da" ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}
