import { DEFAULT_MODEL, DEFAULT_PROMPT, DEMO_MODEL, demoClient, PROMPTS, runAgent, type AgentEvent, type PromptVersion } from "@spoerg-dst/agent";
import { askLimiter, MAX_QUESTION_CHARS, statbankTools } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const json = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(req: Request) {
  let question: unknown;
  try {
    ({ question } = (await req.json()) as { question?: unknown });
  } catch {
    return json(400, "Ugyldig JSON.");
  }
  if (typeof question !== "string" || !question.trim()) return json(400, "Skriv et spørgsmål.");
  if (question.length > MAX_QUESTION_CHARS) return json(400, `Spørgsmålet må højst være ${MAX_QUESTION_CHARS} tegn.`);

  // Without a key the app runs in demo mode: scripted decisions, real tools and live data.
  const demo = process.env.ANTHROPIC_API_KEY ? null : demoClient(question);
  if (!process.env.ANTHROPIC_API_KEY && !demo) {
    return json(503, "Demo-tilstand: ingen API-nøgle på serveren, så kun eksempelspørgsmålene virker.");
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const wait = askLimiter().take(ip);
  if (wait > 0) return json(429, `For mange spørgsmål. Prøv igen om ${Math.ceil(wait / 60_000)} min.`);

  const envPrompt = process.env.AGENT_PROMPT_VERSION;
  const promptVersion: PromptVersion = envPrompt && envPrompt in PROMPTS ? (envPrompt as PromptVersion) : DEFAULT_PROMPT;
  const encoder = new TextEncoder();

  // NDJSON: one AgentEvent per line, so the UI can render steps while the agent works.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: AgentEvent | { type: "error"; message: string }) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          // client disconnected
        }
      };
      try {
        await runAgent(question.trim(), {
          tools: statbankTools(),
          model: demo ? DEMO_MODEL : (process.env.AGENT_MODEL ?? DEFAULT_MODEL),
          ...(demo ? { client: demo } : {}),
          promptVersion,
          onEvent: send,
        });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
