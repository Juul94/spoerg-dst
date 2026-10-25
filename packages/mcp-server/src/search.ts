import type { TableSummary } from "./statbank/schemas.js";

/**
 * Local search over the full table list. The StatBank `searchText` parameter does not filter,
 * so we index ~2,300 tables ourselves (Danish + English titles, ids, variable names).
 *
 * Scoring: exact token hits > prefix/substring hits > character-trigram similarity.
 * Trigrams matter for Danish compounds ("elbiler" vs "personbiler").
 * Tokens are lightly stemmed, queries expanded with a small synonym list (everyday words ->
 * StatBank terms), and short, current titles are preferred. Tuned with evals/src/retrieval.ts.
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

const SUFFIXES = ["erne", "ene", "er", "en", "et", "es", "s", "e"];

/** Light Danish/English suffix stripping: "befolkningen" -> "befolkning", "deaths" -> "death". */
export function stem(t: string): string {
  for (const suf of SUFFIXES) if (t.endsWith(suf) && t.length - suf.length >= 4) return t.slice(0, -suf.length);
  return t;
}

const stems = (s: string) => tokenize(s).map(stem);

/** Everyday words -> the terms StatBank titles and variables use. Keys and values are plain words. */
const SYNONYMS_RAW: Record<string, string> = {
  elbil: "personbil drivmiddel",
  elbiler: "personbil drivmiddel",
  electric: "propellant",
  folketal: "befolkning",
  indbyggere: "befolkning omraade",
  inhabitants: "population region",
  kommune: "omraade",
  kommuner: "omraade",
  municipality: "region",
  dodsfald: "doede",
  doedsfald: "doede",
  fodsler: "levendefoedte",
  foedsler: "levendefoedte",
  inflation: "forbrugerprisindeks consumer price index",
  bnp: "bruttonationalprodukt",
  gdp: "bruttonationalprodukt",
  growth: "vaekst",
  arbejdsloeshed: "fuldtidsledige",
  arbejdsloese: "fuldtidsledige",
  bruttoledige: "fuldtidsledige",
  ledighed: "fuldtidsledige",
  unemployment: "unemployed",
  huspriser: "ejendomssalg prisindeks",
  boligpriser: "ejendomssalg prisindeks",
  house: "property",
  turister: "overnatninger",
  tourists: "nights",
  indvandrere: "herkomst",
  immigrants: "ancestry",
};
/**
 * Headline tables (Statistics Denmark key figures) get a popularity prior. Without usage data,
 * this curated list is the cheapest way to make "befolkning" return FOLK1A instead of one of
 * ~200 niche population tables. It is a deliberate bias: niche tables still rank when the query names them.
 */
const HEADLINE = new Set(["FOLK1A", "FOLK1AM", "BEF5", "BEV22", "BEV3A", "FOD", "DOD", "HISB7", "VIE7", "IEPCT", "BIL51", "BIL10", "HOTEL1", "PRIS111", "PRIS01", "NAN1", "AUS07", "AUS08", "EJ56"]);
const HEADLINE_BOOST = 1.5;

const SYNONYMS = new Map(Object.entries(SYNONYMS_RAW).map(([k, v]) => [stem(fold(k)), stems(v)]));

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
  /** Penalises long, specific titles and stale tables so headline tables win ties. */
  prior: number;
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
      const titleTokens = [...new Set([...stems(t.text), ...stems(e?.text ?? ""), fold(t.id)])];
      const varTokens = [...new Set([...t.variables, ...(e?.variables ?? [])].flatMap(stems))];
      const trigramsByToken = new Map<string, Set<string>>();
      for (const tok of [...titleTokens, ...varTokens]) if (tok.length >= 4) trigramsByToken.set(tok, trigrams(tok));
      return { doc, titleTokens, varTokens, trigramsByToken, prior: 1 };
    });
    const newest = Math.max(...this.docs.map((d) => year(d.doc.latestPeriod)));
    for (const d of this.docs) {
      const titleLen = tokenize(d.doc.textDa).length;
      const age = newest - year(d.doc.latestPeriod);
      d.prior = (1 / (1 + 0.08 * Math.max(0, titleLen - 2))) * (age > 2 ? 0.7 : age > 0 ? 0.9 : 1) * (HEADLINE.has(d.doc.id) ? HEADLINE_BOOST : 1);
    }
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
    const qTokens = [...new Set(stems(query))];
    if (qTokens.length === 0) return [];
    const n = this.docs.length;
    const idf = (tok: string) => Math.log(1 + n / (1 + (this.df.get(tok) ?? 0)));

    const hits: SearchHit[] = [];
    for (const d of this.docs) {
      if (!opts.includeInactive && !d.doc.active) continue;
      let score = 0;
      let matched = 0;
      for (const q of qTokens) {
        let s = this.tokenScore(q, d, idf);
        for (const syn of SYNONYMS.get(q) ?? []) s = Math.max(s, 0.9 * this.tokenScore(syn, d, idf));
        if (s > 0) matched++;
        score += s;
      }
      if (score <= 0) continue;
      // reward documents that cover more of the query
      score *= 0.5 + matched / qTokens.length;
      if (!d.doc.active) score *= 0.6;
      score *= d.prior;
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

/** "2026K3" -> 2026, "2024:2025" -> 2025, missing -> 0. */
function year(period: string | null): number {
  const years = period?.match(/d{4}/g);
  return years ? Number(years.at(-1)) : 0;
}
