import { describe, expect, it } from "vitest";
import { DEMO_QUESTIONS, demoClient } from "../src/demo.js";

describe("demoClient", () => {
  it("has a script for every demo question, matched case- and space-insensitively", () => {
    for (const q of DEMO_QUESTIONS) expect(demoClient(q)).not.toBeNull();
    expect(demoClient("  hvor MANGE bor der i   danmark? ")).not.toBeNull();
    expect(demoClient("Hvad koster en banan?")).toBeNull();
  });

  it("replays tool calls and passes the previous tool results to the next turn", async () => {
    const c = demoClient("Hvor mange katte er der i Danmark?")!;
    const body = { model: "x", max_tokens: 1, messages: [{ role: "user" as const, content: "q" }] };
    const first = await c.messages.create(body);
    expect(first.content.at(-1)).toMatchObject({ type: "tool_use", name: "search_tables" });
    const results = JSON.stringify({ results: [{ id: "PSKAT1" }, { id: "SELSK2" }] });
    const second = await c.messages.create({
      ...body,
      messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "demo_1", content: results }] }],
    });
    const call = second.content.at(-1) as { name: string; input: { status: string; answer: string } };
    expect(call.name).toBe("submit_answer");
    expect(call.input.status).toBe("not_found");
    expect(call.input.answer).toContain("PSKAT1, SELSK2");
  });
});
