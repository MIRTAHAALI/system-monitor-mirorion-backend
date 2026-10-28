const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WINDOW_MS = 60_000;
// Entries are swept periodically so a flood of distinct IPs cannot grow the map forever.
const SWEEP_INTERVAL_MS = 5 * 60_000;

interface Bucket {
  failures: number;
  windowStart: number;
}

/**
 * In-memory fixed-window limiter for failed login attempts, keyed by client IP.
 * A successful login clears the client's counter.
 */
export class LoginRateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(
    private readonly maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
  ) {}

  /** Returns the seconds the client must wait, or 0 when it may try again. */
  retryAfterSeconds(key: string, now: number = Date.now()): number {
    this.sweep(now);
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) return 0;
    if (bucket.failures < this.maxAttempts) return 0;
    return Math.ceil((bucket.windowStart + this.windowMs - now) / 1000);
  }

  recordFailure(key: string, now: number = Date.now()): void {
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      this.buckets.set(key, { failures: 1, windowStart: now });
      return;
    }
    bucket.failures += 1;
  }

  reset(key: string): void {
    this.buckets.delete(key);
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < SWEEP_INTERVAL_MS) return;
    this.lastSweep = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(key);
    }
  }
}
