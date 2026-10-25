import { describe, expect, it } from "vitest";
import { StatbankClient, StatbankError } from "../src/statbank/client.js";
import { RateLimiter } from "../src/statbank/infra.js";
import { fixturesDir, mockFetch } from "./helpers.js";

const info = { id: "X1", text: "Test", variables: [{ id: "Tid", text: "tid", time: true, values: [{ id: "2025", text: "2025" }] }] };
const fast = () => new RateLimiter(4, 0);

describe("StatbankClient", () => {
  it("retries 5xx and then succeeds", async () => {
    const m = mockFetch([{ status: 503, body: "busy" }, { status: 200, body: info }]);
    const c = new StatbankClient({ fetch: m.fetch, limiter: fast() });
    await expect(c.tableInfo("x1")).resolves.toMatchObject({ id: "X1" });
    expect(m.calls).toHaveLength(2);
    expect(m.calls[0]!.body).toMatchObject({ table: "X1", lang: "da" });
  });

  it("does not retry 4xx and surfaces the StatBank error code", async () => {
    const m = mockFetch([{ status: 400, body: { errorTypeCode: "EXTRACT-NOTFOUND", message: "Tabel findes ikke" } }]);
    const c = new StatbankClient({ fetch: m.fetch, limiter: fast() });
    const err = await c.tableInfo("NOPE").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StatbankError);
    expect(err).toMatchObject({ code: "EXTRACT-NOTFOUND", status: 400, retryable: false });
    expect(m.calls).toHaveLength(1);
  });

  it("retries network errors and gives up after the retry budget", async () => {
    const m = mockFetch([new Error("ECONNRESET"), new Error("ECONNRESET")]);
    const c = new StatbankClient({ fetch: m.fetch, retries: 1, limiter: fast() });
    await expect(c.tables()).rejects.toMatchObject({ code: "NETWORK" });
    expect(m.calls).toHaveLength(2);
  });

  it("caches metadata and de-duplicates concurrent requests", async () => {
    const m = mockFetch([{ status: 200, body: info }]);
    const c = new StatbankClient({ fetch: m.fetch, limiter: fast() });
    await Promise.all([c.tableInfo("X1"), c.tableInfo("X1")]);
    await c.tableInfo("x1");
    expect(c.httpCalls).toBe(1);
  });

  it("validates responses with Zod", async () => {
    const m = mockFetch([{ status: 200, body: { id: "X1" } }]);
    const c = new StatbankClient({ fetch: m.fetch, limiter: fast() });
    await expect(c.tableInfo("X1")).rejects.toThrow();
  });

  it("fails clearly when a fixture is missing in replay mode", async () => {
    const c = new StatbankClient({ mode: "replay", fixturesDir });
    await expect(c.tableInfo("NOT_RECORDED")).rejects.toMatchObject({ code: "FIXTURE-MISSING" });
  });
});
