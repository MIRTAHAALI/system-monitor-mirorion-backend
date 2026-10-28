interface Entry<T> {
  value?: T;
  expiresAt: number;
  inFlight?: Promise<T>;
}

/**
 * Caches the result of an async loader for `ttlMs`. Concurrent callers share one in-flight
 * call, so a slow probe (spawning `ioreg`, `nvidia-smi`, `ps`, ...) never runs twice at once.
 * Failed loads are not cached.
 */
export class TtlCache {
  private readonly entries = new Map<string, Entry<unknown>>();

  get<T>(key: string, ttlMs: number, loader: () => Promise<T>, now: number = Date.now()): Promise<T> {
    const entry = this.entries.get(key) as Entry<T> | undefined;
    if (entry?.inFlight) return entry.inFlight;
    if (entry && 'value' in entry && entry.expiresAt > now) return Promise.resolve(entry.value as T);

    const inFlight = loader().then(
      (value) => {
        this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
        return value;
      },
      (error) => {
        // Keep a previous good value around so a later call can retry.
        if (entry && 'value' in entry) {
          this.entries.set(key, { value: entry.value, expiresAt: 0 });
        } else {
          this.entries.delete(key);
        }
        throw error;
      },
    );
    this.entries.set(key, { ...entry, expiresAt: entry?.expiresAt ?? 0, inFlight });
    return inFlight;
  }
}
