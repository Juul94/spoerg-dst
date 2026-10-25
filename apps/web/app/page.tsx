"use client";

import type { AgentEvent, AgentResult } from "@spoerg-dst/agent";
import { useRef, useState, type FormEvent } from "react";
import { Chart } from "@/components/Chart";

const EXAMPLES = [
  "Hvor mange elbiler blev indregistreret i 2025?",
  "Hvordan har befolkningstallet udviklet sig siden 2015?",
  "Hvad var inflationen i Danmark sidste år?",
  "How many people live in Aarhus municipality?",
  "Hvor mange katte er der i Danmark?",
];

type StreamEvent = AgentEvent | { type: "error"; message: string };

interface Step {
  id: string;
  tool: string;
  reason: string;
  input: unknown;
  ok?: boolean;
  latency_ms?: number;
  preview?: string;
}

const TOOL_LABEL: Record<string, string> = {
  search_tables: "Søger tabeller",
  get_table_info: "Læser metadata",
  get_data: "Henter data",
  submit_answer: "Formulerer svar",
};

export default function Page() {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [result, setResult] = useState<AgentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  function onEvent(e: StreamEvent) {
    switch (e.type) {
      case "start":
        setModel(e.model);
        break;
      case "tool_call":
        if (e.tool === "submit_answer") break;
        setSteps((s) => [...s, { id: e.id, tool: e.tool, reason: e.reason, input: e.input }]);
        break;
      case "tool_result":
        setSteps((s) => s.map((x) => (x.id === e.id ? { ...x, ok: e.ok, latency_ms: e.latency_ms, preview: e.preview } : x)));
        break;
      case "final":
        setResult(e.result);
        break;
      case "error":
        setError(e.message);
        break;
    }
  }

  async function ask(q: string) {
    if (!q.trim() || busy) return;
    abort.current?.abort();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setQuestion(q);
    setBusy(true);
    setSteps([]);
    setResult(null);
    setError(null);
    setModel(null);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) onEvent(JSON.parse(line) as StreamEvent);
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (abort.current === ctrl) setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void ask(question);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Spørg Danmarks Statistik</h1>
        <p className="mt-2 text-muted">
          Stil et spørgsmål på dansk eller engelsk. Agenten finder tabellen i Statistikbanken, henter tallene og viser kilden.
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-2 sm:flex-row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={300}
          placeholder="Fx: Hvor mange bor der i Danmark?"
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-4 py-3 outline-none focus:border-accent"
          aria-label="Spørgsmål"
        />
        <button
          type="submit"
          disabled={busy || !question.trim()}
          className="rounded-lg bg-accent px-5 py-3 font-medium text-white disabled:opacity-50"
        >
          {busy ? "Arbejder…" : "Spørg"}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => void ask(q)}
            disabled={busy}
            className="rounded-full border border-line bg-panel px-3 py-1 text-sm text-muted hover:border-accent hover:text-ink disabled:opacity-50"
          >
            {q}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="mt-8 rounded-xl border border-accent bg-accent-soft p-4 text-sm">
          {error}
        </div>
      )}

      {(steps.length > 0 || busy) && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted">
            Trin {model && <span className="normal-case tracking-normal">· {model}</span>}
          </h2>
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={s.id} className="rounded-lg border border-line bg-panel px-4 py-3 text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">
                    {i + 1}. {TOOL_LABEL[s.tool] ?? s.tool}
                    <code className="ml-2 font-mono text-xs text-muted">{s.tool}</code>
                  </span>
                  <span className={`shrink-0 text-xs ${s.ok === false ? "text-accent" : "text-muted"}`}>
                    {s.ok === undefined ? "…" : s.ok ? `${s.latency_ms} ms` : "fejl"}
                  </span>
                </div>
                {s.reason && <p className="mt-1 text-muted">{s.reason}</p>}
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted">Input / output</summary>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs">{JSON.stringify(s.input, null, 2)}</pre>
                  {s.preview && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs text-muted">{s.preview}</pre>}
                </details>
              </li>
            ))}
            {busy && !result && <li className="animate-pulse px-4 py-2 text-sm text-muted">Tænker…</li>}
          </ol>
        </section>
      )}

      {result && <Answer result={result} />}
    </main>
  );
}

function Answer({ result }: { result: AgentResult }) {
  const t = result.trace;
  const tokens = t.usage.input_tokens + t.usage.output_tokens + t.usage.cache_read_input_tokens + t.usage.cache_creation_input_tokens;
  return (
    <section className="mt-8 space-y-4">
      <div
        className={`rounded-xl border p-5 ${result.status === "answered" ? "border-line bg-panel" : "border-accent bg-accent-soft"}`}
      >
        {result.status === "not_found" && <p className="mb-2 text-sm font-medium text-accent">Kunne ikke finde data</p>}
        {result.status === "failed" && (
          <p className="mb-2 text-sm font-medium text-accent">Fejlede: {result.failure?.reason}</p>
        )}
        <p className="text-lg leading-relaxed">{result.answer}</p>

        {result.values.length > 0 && (
          <dl className="mt-4 grid gap-2 sm:grid-cols-2">
            {result.values.map((v, i) => (
              <div key={i} className="rounded-lg border border-line px-3 py-2">
                <dt className="text-xs text-muted">
                  {v.label}
                  {v.period && ` · ${v.period}`}
                  {v.computed && " · beregnet"}
                </dt>
                <dd className="font-mono text-lg">
                  {v.value.toLocaleString("da-DK")}
                  {v.unit && <span className="ml-1 text-sm text-muted">{v.unit}</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {result.calculation && (
          <p className="mt-4 text-sm">
            <span className="text-muted">Beregning: </span>
            <code className="font-mono">{result.calculation}</code>
          </p>
        )}
        {result.assumptions && (
          <p className="mt-2 text-sm">
            <span className="text-muted">Antagelse: </span>
            {result.assumptions}
          </p>
        )}
      </div>

      {result.chart && <Chart spec={result.chart} />}

      {result.sources.length > 0 && (
        <div className="rounded-xl border border-line bg-panel p-5 text-sm">
          <h3 className="mb-2 font-medium">Kilde</h3>
          <ul className="space-y-3">
            {result.sources.map((s) => (
              <li key={s.result_id}>
                <a href={s.statbank_url} target="_blank" rel="noreferrer" className="font-medium text-accent underline">
                  {s.table_id}
                </a>
                <span className="ml-2">{s.title}</span>
                <ul className="mt-1 text-muted">
                  {s.api_query.variables.map((v) => (
                    <li key={v.code}>
                      <code className="font-mono">{v.code}</code> = {v.values.join(", ")}
                    </li>
                  ))}
                </ul>
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs text-muted">API-forespørgsel</summary>
                  <pre className="mt-2 overflow-x-auto font-mono text-xs">{JSON.stringify(s.api_query, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-muted">
        {t.tool_calls} værktøjskald · {tokens.toLocaleString("da-DK")} tokens ·{" "}
        {t.cost_usd !== null ? `$${t.cost_usd.toFixed(4)}` : "pris ukendt"} · {(t.latency_ms / 1000).toFixed(1)} s · {t.model} /{" "}
        {t.prompt_version}
      </p>
    </section>
  );
}
