import type { TableSummary } from "./statbank/schemas.js";

/**
 * Local search over the full table list. The StatBank `searchText` parameter does not filter,
 * so we index ~2,300 tables ourselves (Danish + English titles, ids, variable names).
 *
 * Scoring: exact token hits > prefix/substring hits > character-trigram similarity.
 * Trigrams matter for Danish compounds ("elbiler" vs "personbiler").
 */

export interface SearchDoc {
  id: string;
  textDa: string;
  textEn: string;
  variables: string[];
  unit: string | null;
  firstPeriod: string | null;
  latestPeriod: string | null;
  updated: string | null;
  active: boolean;
}

export interface SearchHit extends SearchDoc {
  score: number;
}

const STOPWORDS = new Set([
  // da
  "og", "i", "på", "af", "for", "til", "med", "den", "det", "de", "en", "et", "er", "hvor", "hvad", "mange", "hvordan",
  "var", "som", "fra", "efter", "om", "der", "har", "blev", "ved", "sidste", "seneste", "år", "antal", "danmark", "dk",
  // en
  "the", "of", "and", "in", "on", "for", "to", "by", "a", "an", "is", "how", "many", "what", "was", "were", "denmark",
  "number", "latest", "last", "year", "from", "with", "per",
]);

export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");
}

export function tokenize(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function trigrams(token: string): Set<string> {
  const padded = ` ${token} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

function trigramSim(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  return inter / Math.max(a.size, 1);
}

interface IndexedDoc {
  doc: SearchDoc;
  titleTokens: string[];
  varTokens: string[];
  trigramsByToken: Map<string, Set<string>>;
}

export class TableIndex {
  private docs: IndexedDoc[];
  private df = new Map<string, number>();

  constructor(da: TableSummary[], en: TableSummary[]) {
    const enById = new Map(en.map((t) => [t.id, t]));
    this.docs = da.map((t) => {
      const e = enById.get(t.id);
      const doc: SearchDoc = {
        id: t.id,
        textDa: t.text,
        textEn: e?.text ?? t.text,
        variables: t.variables,
        unit: t.unit ?? null,
        firstPeriod: t.firstPeriod ?? null,
        latestPeriod: t.latestPeriod ?? null,
        updated: t.updated ?? null,
        active: t.active ?? true,
      };
      const titleTokens = [...new Set([...tokenize(t.text), ...tokenize(e?.text ?? ""), fold(t.id)])];
      const varTokens = [...new Set([...t.variables, ...(e?.variables ?? [])].flatMap(tokenize))];
      const trigramsByToken = new Map<string, Set<string>>();
      for (const tok of [...titleTokens, ...varTokens]) if (tok.length >= 4) trigramsByToken.set(tok, trigrams(tok));
      return { doc, titleTokens, varTokens, trigramsByToken };
    });
    for (const d of this.docs) for (const tok of new Set([...d.titleTokens, ...d.varTokens])) this.df.set(tok, (this.df.get(tok) ?? 0) + 1);
  }

  get size() {
    return this.docs.length;
  }

  get(id: string): SearchDoc | undefined {
    return this.docs.find((d) => d.doc.id === id.toUpperCase())?.doc;
  }

  search(query: string, opts: { limit?: number; includeInactive?: boolean } = {}): SearchHit[] {
    const limit = opts.limit ?? 10;
    const qTokens = [...new Set(tokenize(query))];
    if (qTokens.length === 0) return [];
    const n = this.docs.length;
    const idf = (tok: string) => Math.log(1 + n / (1 + (this.df.get(tok) ?? 0)));

    const hits: SearchHit[] = [];
    for (const d of this.docs) {
      if (!opts.includeInactive && !d.doc.active) continue;
      let score = 0;
      let matched = 0;
      for (const q of qTokens) {
        const s = this.tokenScore(q, d, idf);
        if (s > 0) matched++;
        score += s;
      }
      if (score <= 0) continue;
      // reward documents that cover more of the query
      score *= 0.5 + matched / qTokens.length;
      if (!d.doc.active) score *= 0.6;
      hits.push({ ...d.doc, score: Math.round(score * 100) / 100 });
    }
    return hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }

  private tokenScore(q: string, d: IndexedDoc, idf: (t: string) => number): number {
    if (d.doc.id.toLowerCase() === q) return 10;
    let best = 0;
    const consider = (tokens: string[], weight: number) => {
      for (const t of tokens) {
        let s = 0;
        if (t === q) s = 1;
        else if (q.length >= 3 && (t.startsWith(q) || q.startsWith(t)) && Math.min(t.length, q.length) >= 3) s = 0.75;
        else if (q.length >= 4 && t.length >= 4 && (t.includes(q) || q.includes(t))) s = 0.6;
        else if (q.length >= 4 && t.length >= 4) {
          const sim = trigramSim(trigrams(q), d.trigramsByToken.get(t) ?? trigrams(t));
          if (sim >= 0.5) s = sim * 0.5;
        }
        if (s > 0) best = Math.max(best, s * weight * idf(t === q ? q : t));
      }
    };
    consider(d.titleTokens, 1);
    consider(d.varTokens, 0.4);
    return best;
  }
}
