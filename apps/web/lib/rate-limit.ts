/** Fixed-window limiter keyed by client (IP). In-memory: per server instance, which is enough for a demo. */
export class WindowLimiter {
  private hits = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns 0 if allowed, otherwise the milliseconds until the window resets. */
  take(key: string): number {
    const t = this.now();
    const h = this.hits.get(key);
    if (!h || t - h.start >= this.windowMs) {
      this.hits.set(key, { start: t, count: 1 });
      if (this.hits.size > 10_000) this.prune(t);
      return 0;
    }
    if (h.count >= this.limit) return this.windowMs - (t - h.start);
    h.count++;
    return 0;
  }

  private prune(t: number) {
    for (const [k, h] of this.hits) if (t - h.start >= this.windowMs) this.hits.delete(k);
  }
}
