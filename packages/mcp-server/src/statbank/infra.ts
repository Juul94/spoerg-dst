/** Small infrastructure pieces: TTL cache, rate limiter, sleep. No dependencies on purpose. */

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class TtlCache<V> {
  private store = new Map<string, { value: V; expires: number }>();
  constructor(private readonly maxEntries = 500) {}

  get(key: string): V | undefined {
    const hit = this.store.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    // refresh LRU position
    this.store.delete(key);
    this.store.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expires: Date.now() + ttlMs });
  }

  get size() {
    return this.store.size;
  }
}

/**
 * Limits concurrency and enforces a minimum gap between request starts.
 * StatBank has no published hard limit; we stay polite (default 4 parallel, 100 ms apart).
 */
export class RateLimiter {
  private active = 0;
  private queue: Array<() => void> = [];
  private lastStart = 0;

  constructor(
    private readonly maxConcurrent = 4,
    private readonly minIntervalMs = 100,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    const wait = this.lastStart + this.minIntervalMs - Date.now();
    this.lastStart = Math.max(Date.now(), this.lastStart + this.minIntervalMs);
    if (wait > 0) await sleep(wait);
  }
}

/** Stable JSON stringify (sorted keys) so equal requests hash equally. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
