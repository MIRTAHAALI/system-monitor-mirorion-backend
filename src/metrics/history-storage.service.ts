import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { LoggerService } from '../logger/logger.service';

export interface HistoryEntry {
  timestamp: string;
  value: number;
}

export type MetricKey = 'cpu' | 'memory' | 'networkDownload' | 'networkUpload' | 'disk' | 'battery' | 'gpu' | 'temperature';

export const METRICS: readonly MetricKey[] = ['cpu', 'memory', 'networkDownload', 'networkUpload', 'disk', 'battery', 'gpu', 'temperature'];

export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === 'string' && (METRICS as readonly string[]).includes(value);
}

const CSV_HEADER = 'timestamp,value';
const DEFAULT_RETENTION_POLICY = '1d';
const DEFAULT_CACHE_ENTRIES = 5000;
const DEFAULT_HISTORY_LIMIT = 1000;

// How long each retention policy keeps data.
const RETENTION_MS: Record<string, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
  '3m': 90 * 24 * 60 * 60 * 1000,
  '6m': 182 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

export const RETENTION_POLICIES = Object.keys(RETENTION_MS);

// Hard row cap per metric for each policy, so a bad clock or missed compaction cannot
// grow the files without bound.
const MAX_ENTRIES: Record<string, number> = {
  '1d': 86400,
  '1w': 100800,
  '1m': 43200,
  '3m': 43200,
  '6m': 43200,
  '1y': 52560,
};

// Samples are appended to a buffer and only touched on disk on this interval.
const FLUSH_INTERVAL_MS = 5_000;
// Retention is checked every ~10 minutes; compaction only runs when enough rows expired.
const COMPACTION_CHECK_INTERVAL_TICKS = 120;
const COMPACTION_MIN_EXPIRED_FRACTION = 0.1;
// Backwards reads and scans work in fixed size chunks so a query never loads a whole file.
const IO_CHUNK_BYTES = 64 * 1024;
// Compaction streams rows through a small in-memory buffer before renaming the file.
const COMPACT_FLUSH_BYTES = 256 * 1024;

interface FileStats {
  entries: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
}

/**
 * Append-only CSV history store.
 *
 * Each metric lives in `data/history/<metric>.csv` (`timestamp,value` rows, oldest first).
 * Appends are cheap: samples are appended to an in-memory line buffer and written with a
 * single `appendFile` call every few seconds, instead of re-serialising and rewriting every
 * file on every flush. Only a small newest-N window is kept in RAM; older rows are read from
 * disk on demand, backwards from EOF, and expired rows are removed by periodic compaction.
 */
@Injectable()
export class HistoryStorageService implements OnModuleDestroy {
  private readonly logger: any;
  private readonly historyDir: string;
  private readonly cacheEntries: number;

  /** Newest entries per metric, kept in memory for fast reads. */
  private cache: Map<MetricKey, HistoryEntry[]> = new Map();
  /** CSV lines waiting to be appended to disk. */
  private pending: Map<MetricKey, string[]> = new Map();
  /** Total rows currently stored on disk per metric. */
  private totalEntries: Map<MetricKey, number> = new Map();
  private firstTimestamps: Map<MetricKey, string | undefined> = new Map();
  private lastTimestamps: Map<MetricKey, string | undefined> = new Map();

  private retentionPolicy: string;
  private maintenanceTimer: NodeJS.Timeout | null = null;
  private tick = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly loggerService: LoggerService,
  ) {
    this.logger = loggerService.child('HistoryStorage');
    this.historyDir =
      this.configService.get<string>('historyDir') || path.join(process.cwd(), 'data', 'history');
    const configuredCache = this.configService.get<number>(
      'historyCacheEntries',
      DEFAULT_CACHE_ENTRIES,
    );
    this.cacheEntries = Number.isFinite(configuredCache)
      ? Math.max(100, configuredCache)
      : DEFAULT_CACHE_ENTRIES;
    this.retentionPolicy = this.normalizePolicy(
      this.configService.get<string>('historyRetentionPolicy', DEFAULT_RETENTION_POLICY),
    );

    this.ensureHistoryDir();

    for (const metric of METRICS) {
      this.cache.set(metric, []);
      this.pending.set(metric, []);
      this.totalEntries.set(metric, 0);
      this.firstTimestamps.set(metric, undefined);
      this.lastTimestamps.set(metric, undefined);
      this.migrateLegacyJson(metric);
      this.loadFromDisk(metric);
    }

    const timer = setInterval(() => this.runMaintenance(), FLUSH_INTERVAL_MS);
    // Never keep the process alive on its own because of history maintenance.
    timer.unref();
    this.maintenanceTimer = timer;
  }

  // ---------------------------------------------------------------- startup

  private ensureHistoryDir(): void {
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  private filePath(metric: MetricKey): string {
    // Metric names become file names, so anything outside the known set is rejected outright.
    if (!isMetricKey(metric)) throw new Error(`Unknown metric "${metric}"`);
    return path.join(this.historyDir, `${metric}.csv`);
  }

  private legacyJsonPath(metric: MetricKey): string {
    if (!isMetricKey(metric)) throw new Error(`Unknown metric "${metric}"`);
    return path.join(this.historyDir, `${metric}.json`);
  }

  /**
   * One-time upgrade path: convert the old JSON snapshot into CSV and park the old file
   * aside (never deleted, so nothing is lost if something goes wrong).
   */
  private migrateLegacyJson(metric: MetricKey): void {
    const csvPath = this.filePath(metric);
    const jsonPath = this.legacyJsonPath(metric);
    if (fs.existsSync(csvPath) || !fs.existsSync(jsonPath)) return;

    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const parsed = JSON.parse(raw) as { entries?: HistoryEntry[] };
      const entries = Array.isArray(parsed?.entries) ? parsed.entries : [];
      const lines = [CSV_HEADER];
      for (const entry of entries) {
        if (!entry || typeof entry.timestamp !== 'string' || !Number.isFinite(entry.value)) continue;
        lines.push(`${entry.timestamp},${entry.value}`);
      }
      // Compacted once at startup so a huge legacy file is pruned before it lands on disk.
      const pruned = this.pruneLines(lines);
      fs.writeFileSync(csvPath, `${pruned.join('\n')}\n`, 'utf-8');
      fs.renameSync(jsonPath, `${jsonPath}.legacy`);
      this.logger.info(`Migrated ${pruned.length - 1} history entries for ${metric} from JSON to CSV`);
    } catch (err) {
      this.logger.error(`Failed to migrate legacy history for ${metric}: ${err}`);
    }
  }

  private loadFromDisk(metric: MetricKey): void {
    const fp = this.filePath(metric);
    if (!fs.existsSync(fp)) return;

    try {
      const stats = this.scanFile(fp);
      this.totalEntries.set(metric, stats.entries);
      this.firstTimestamps.set(metric, stats.firstTimestamp);
      this.lastTimestamps.set(metric, stats.lastTimestamp);
      // Only the newest window is held in RAM; the rest stays on disk.
      this.cache.set(metric, this.readEntriesFromEnd(fp, undefined, undefined, this.cacheEntries));
      this.logger.info(
        `Loaded ${stats.entries} CSV history entries for ${metric} (${this.cache.get(metric)!.length} cached)`,
      );
    } catch (err) {
      this.logger.error(`Failed to load history for ${metric}: ${err}`);
      this.totalEntries.set(metric, 0);
      this.cache.set(metric, []);
    }
  }

  /** Single chunked pass: count rows and remember the first/last timestamps. */
  private scanFile(filePath: string): FileStats {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
    const stats: FileStats = { entries: 0 };
    let position = 0;
    let carry = '';
    try {
      for (;;) {
        const read = fs.readSync(fd, buffer, 0, IO_CHUNK_BYTES, position);
        if (read <= 0) break;
        position += read;
        const lines = (carry + buffer.toString('utf8', 0, read)).split('\n');
        carry = lines.pop() ?? '';
        for (const raw of lines) {
          const timestamp = this.timestampOf(raw);
          if (!timestamp) continue;
          stats.entries += 1;
          if (!stats.firstTimestamp) stats.firstTimestamp = timestamp;
          stats.lastTimestamp = timestamp;
        }
      }
      const timestamp = this.timestampOf(carry);
      if (timestamp) {
        stats.entries += 1;
        if (!stats.firstTimestamp) stats.firstTimestamp = timestamp;
        stats.lastTimestamp = timestamp;
      }
    } finally {
      fs.closeSync(fd);
    }
    return stats;
  }

  // ----------------------------------------------------------------- writes

  append(metric: MetricKey, timestamp: string, value: number): void {
    if (!METRICS.includes(metric) || !Number.isFinite(value)) return;

    const pending = this.pending.get(metric);
    if (pending) pending.push(`${timestamp},${value}`);

    const cached = this.cache.get(metric)!;
    cached.push({ timestamp, value });
    if (cached.length > this.cacheEntries) {
      cached.splice(0, cached.length - this.cacheEntries);
    }

    this.totalEntries.set(metric, (this.totalEntries.get(metric) ?? 0) + 1);
    if (!this.firstTimestamps.get(metric)) this.firstTimestamps.set(metric, timestamp);
    this.lastTimestamps.set(metric, timestamp);
  }

  /** Flushes every metric's buffered samples to its CSV file. */
  flushToDisk(): void {
    for (const metric of METRICS) {
      this.flushMetric(metric);
    }
  }

  private flushMetric(metric: MetricKey): void {
    const pending = this.pending.get(metric);
    if (!pending || pending.length === 0) return;

    const payload = `${pending.join('\n')}\n`;
    try {
      const fp = this.filePath(metric);
      if (!fs.existsSync(fp)) {
        fs.writeFileSync(fp, `${CSV_HEADER}\n`, 'utf-8');
      }
      fs.appendFileSync(fp, payload, 'utf-8');
      pending.length = 0;
    } catch (err) {
      this.logger.error(`Failed to flush history for ${metric}: ${err}`);
    }
  }

  // ------------------------------------------------------------------ reads

  getHistory(
    metric: MetricKey,
    limit: number = 100,
    startTime?: string,
    endTime?: string,
  ): HistoryEntry[] {
    if (!isMetricKey(metric)) return [];
    const safeLimit = this.normalizeLimit(limit, 100);
    const cached = this.cache.get(metric) ?? [];
    const total = this.totalEntries.get(metric) ?? 0;
    const firstCached = cached.length ? cached[0].timestamp : undefined;

    const enoughCached = cached.length >= Math.min(safeLimit, total);
    const rangeCached =
      (!startTime || (firstCached !== undefined && firstCached <= startTime)) &&
      (!endTime || firstCached === undefined || endTime >= firstCached);

    if (enoughCached && rangeCached) {
      return this.sliceEntries(cached, safeLimit, startTime, endTime);
    }

    // Everything buffered is about to be read back from disk, so persist it first.
    this.flushMetric(metric);
    const fp = this.filePath(metric);
    if (!fs.existsSync(fp)) {
      return this.sliceEntries(this.cache.get(metric) ?? [], safeLimit, startTime, endTime);
    }

    try {
      return this.readEntriesFromEnd(fp, startTime, endTime, safeLimit);
    } catch (err) {
      this.logger.error(`Failed to read history for ${metric}: ${err}`);
      return this.sliceEntries(cached, safeLimit, startTime, endTime);
    }
  }

  /**
   * Reads newest-first backwards from EOF in fixed size chunks, stopping as soon as the
   * requested rows (or the start of the range) are found. A wide `limit` never forces the
   * whole file into memory unless the whole file is genuinely requested.
   */
  private readEntriesFromEnd(
    filePath: string,
    startTime?: string,
    endTime?: string,
    limit: number = Infinity,
  ): HistoryEntry[] {
    const entries: HistoryEntry[] = [];
    if (limit <= 0) return entries;

    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
    try {
      const size = fs.fstatSync(fd).size;
      let position = size;
      // Head of the oldest line seen so far. It may be incomplete (its start lives in an
      // older chunk), so it is carried into the next read instead of being parsed now.
      let fragment = '';
      let done = false;

      while (position > 0 && !done) {
        const start = Math.max(0, position - IO_CHUNK_BYTES);
        const readSize = position - start;
        fs.readSync(fd, buffer, 0, readSize, start);
        position = start;

        // Chunks always end exactly where the previous (newer) chunk started, so appending
        // the carried fragment rebuilds any line that straddled the boundary.
        const text = buffer.toString('utf8', 0, readSize) + fragment;
        const pieces = text.split('\n');
        fragment = pieces.shift() ?? '';

        for (let i = pieces.length - 1; i >= 0; i--) {
          const entry = this.parseLine(pieces[i]);
          if (!entry) continue;
          if (endTime && entry.timestamp > endTime) continue;
          if (startTime && entry.timestamp < startTime) {
            done = true;
            break;
          }
          entries.push(entry);
          if (entries.length >= limit) {
            done = true;
            break;
          }
        }
      }

      // Reached the top of the file: the leftover fragment is its first (complete) line.
      if (!done && fragment) {
        const entry = this.parseLine(fragment);
        if (
          entry &&
          (!endTime || entry.timestamp <= endTime) &&
          (!startTime || entry.timestamp >= startTime)
        ) {
          entries.push(entry);
        }
      }
    } finally {
      fs.closeSync(fd);
    }

    return entries.reverse();
  }

  getAllHistory(
    limit: number = DEFAULT_HISTORY_LIMIT,
    startTime?: string,
    endTime?: string,
  ): Record<MetricKey, HistoryEntry[]> {
    const safeLimit = this.normalizeLimit(limit, DEFAULT_HISTORY_LIMIT);
    const result = {} as Record<MetricKey, HistoryEntry[]>;
    for (const metric of METRICS) {
      result[metric] = this.sliceEntries(
        this.cache.get(metric) ?? [],
        safeLimit,
        startTime,
        endTime,
      );
    }
    return result;
  }

  private sliceEntries(
    entries: HistoryEntry[],
    limit: number,
    startTime?: string,
    endTime?: string,
  ): HistoryEntry[] {
    const filtered = entries.filter(
      (entry) =>
        (!startTime || entry.timestamp >= startTime) && (!endTime || entry.timestamp <= endTime),
    );
    return filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;
  }

  // ------------------------------------------------------------- management

  clearHistory(metric?: MetricKey): void {
    if (metric !== undefined && !isMetricKey(metric)) return;
    const targets = metric ? [metric] : METRICS;
    for (const target of targets) {
      this.cache.set(target, []);
      this.pending.set(target, []);
      this.totalEntries.set(target, 0);
      this.firstTimestamps.set(target, undefined);
      this.lastTimestamps.set(target, undefined);
      try {
        const fp = this.filePath(target);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch (err) {
        this.logger.error(`Failed to clear history file for ${target}: ${err}`);
      }
    }
    this.logger.info(`History cleared${metric ? ` for ${metric}` : ' (all metrics)'}`);
  }

  setRetentionPolicy(policy: string): void {
    const normalized = this.normalizePolicy(policy);
    if (normalized !== policy.trim()) {
      this.logger.warn(`Unknown retention policy "${policy}", keeping "${this.retentionPolicy}"`);
      return;
    }
    this.retentionPolicy = normalized;
    for (const metric of METRICS) {
      this.maybeCompact(metric);
    }
    this.logger.info(`History retention policy set to ${policy}`);
  }

  getRetentionPolicy(): string {
    return this.retentionPolicy;
  }

  getStats(): { metrics: string[]; totalEntries: number; retentionPolicy: string } {
    let total = 0;
    for (const metric of METRICS) {
      total += this.totalEntries.get(metric) ?? 0;
    }
    return { metrics: [...METRICS], totalEntries: total, retentionPolicy: this.retentionPolicy };
  }

  // -------------------------------------------------------------- retention

  /** Flushes pending samples and occasionally compacts files whose head has expired. */
  private runMaintenance(): void {
    this.tick += 1;
    const checkRetention = this.tick % COMPACTION_CHECK_INTERVAL_TICKS === 0;
    for (const metric of METRICS) {
      if (checkRetention) this.maybeCompact(metric);
    }
    this.flushToDisk();
  }

  private retentionMs(): number {
    return RETENTION_MS[this.retentionPolicy] ?? RETENTION_MS[DEFAULT_RETENTION_POLICY];
  }

  private maxEntries(): number {
    return MAX_ENTRIES[this.retentionPolicy] ?? MAX_ENTRIES[DEFAULT_RETENTION_POLICY];
  }

  /**
   * Compaction rewrites a file, so it only runs when it is actually worth it: the row cap was
   * exceeded, or roughly a tenth of the stored window has aged out of the retention period.
   */
  private maybeCompact(metric: MetricKey): void {
    const fp = this.filePath(metric);
    if (!fs.existsSync(fp)) return;

    const total = this.totalEntries.get(metric) ?? 0;
    if (total > this.maxEntries()) {
      this.compact(metric);
      return;
    }

    const firstTimestamp = this.firstTimestamps.get(metric);
    const lastTimestamp = this.lastTimestamps.get(metric);
    if (!firstTimestamp || !lastTimestamp) return;

    const firstMs = Date.parse(firstTimestamp);
    const lastMs = Date.parse(lastTimestamp);
    if (!Number.isFinite(firstMs)) return;

    const cutoff = Date.now() - this.retentionMs();
    if (firstMs >= cutoff) return;

    const span = Math.max(1, (Number.isFinite(lastMs) ? lastMs : Date.now()) - firstMs);
    const expiredFraction = Math.min(1, (cutoff - firstMs) / span);
    if (expiredFraction >= COMPACTION_MIN_EXPIRED_FRACTION) {
      this.compact(metric);
    }
  }

  /** Streams the CSV through a small buffer, drops expired rows, then swaps the file in. */
  private compact(metric: MetricKey): void {
    const fp = this.filePath(metric);
    if (!fs.existsSync(fp)) return;

    this.flushMetric(metric);
    const cutoffIso = new Date(Date.now() - this.retentionMs()).toISOString();
    const maxEntries = this.maxEntries();
    const dropFromFront = Math.max(0, (this.totalEntries.get(metric) ?? 0) - maxEntries);
    const tmpPath = `${fp}.tmp`;

    let inFd: number | null = null;
    let outFd: number | null = null;
    try {
      inFd = fs.openSync(fp, 'r');
      outFd = fs.openSync(tmpPath, 'w');
      fs.writeSync(outFd, `${CSV_HEADER}\n`);

      const buffer = Buffer.allocUnsafe(IO_CHUNK_BYTES);
      let out: string[] = [];
      let outBytes = 0;
      let position = 0;
      let carry = '';
      let kept = 0;
      let index = 0;
      let firstKept: string | undefined;
      let lastKept: string | undefined;

      const drain = () => {
        if (out.length === 0) return;
        fs.writeSync(outFd!, out.join('\n') + '\n');
        out = [];
        outBytes = 0;
      };

      const handleLine = (raw: string) => {
        const entry = this.parseLine(raw);
        if (!entry) return;
        const current = index++;
        if (current < dropFromFront || entry.timestamp < cutoffIso) return;
        kept += 1;
        if (!firstKept) firstKept = entry.timestamp;
        lastKept = entry.timestamp;
        const line = `${entry.timestamp},${entry.value}`;
        out.push(line);
        outBytes += line.length + 1;
        if (outBytes >= COMPACT_FLUSH_BYTES) drain();
      };

      for (;;) {
        const read = fs.readSync(inFd, buffer, 0, IO_CHUNK_BYTES, position);
        if (read <= 0) break;
        position += read;
        const lines = (carry + buffer.toString('utf8', 0, read)).split('\n');
        carry = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
      }
      handleLine(carry);
      drain();

      fs.closeSync(outFd);
      outFd = null;
      fs.closeSync(inFd);
      inFd = null;
      fs.renameSync(tmpPath, fp);

      this.totalEntries.set(metric, kept);
      this.firstTimestamps.set(metric, firstKept);
      this.lastTimestamps.set(metric, lastKept);
      this.cache.set(metric, this.readEntriesFromEnd(fp, undefined, undefined, this.cacheEntries));
      this.logger.info(`Compacted history for ${metric}: ${kept} entries retained`);
    } catch (err) {
      this.logger.error(`Failed to compact history for ${metric}: ${err}`);
    } finally {
      if (outFd !== null) {
        try {
          fs.closeSync(outFd);
        } catch {
          /* ignore */
        }
      }
      if (inFd !== null) {
        try {
          fs.closeSync(inFd);
        } catch {
          /* ignore */
        }
      }
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  // ----------------------------------------------------------------- export

  exportCsv(metric: MetricKey, startTime?: string, endTime?: string): string {
    const entries = this.getHistory(metric, Number.MAX_SAFE_INTEGER, startTime, endTime);
    const lines = [CSV_HEADER];
    for (const entry of entries) {
      lines.push(`${entry.timestamp},${entry.value}`);
    }
    return lines.join('\n');
  }

  exportAllCsv(startTime?: string, endTime?: string): string {
    const lines = [`timestamp,${METRICS.join(',')}`];

    // Build a unified timeline of the cached newest rows for each metric.
    const timeline = new Map<string, Partial<Record<MetricKey, number>>>();
    for (const metric of METRICS) {
      for (const entry of this.getHistory(metric, Number.MAX_SAFE_INTEGER, startTime, endTime)) {
        let row = timeline.get(entry.timestamp);
        if (!row) {
          row = {};
          timeline.set(entry.timestamp, row);
        }
        row[metric] = entry.value;
      }
    }

    const sorted = Array.from(timeline.keys()).sort();
    for (const timestamp of sorted) {
      const row = timeline.get(timestamp)!;
      lines.push(`${timestamp},${METRICS.map((metric) => row[metric] ?? '').join(',')}`);
    }

    return lines.join('\n');
  }

  // ----------------------------------------------------------------- helpers

  private pruneLines(lines: string[]): string[] {
    const cutoffIso = new Date(Date.now() - this.retentionMs()).toISOString();
    const kept: string[] = [];
    for (const line of lines) {
      const entry = this.parseLine(line);
      if (entry && entry.timestamp >= cutoffIso) kept.push(line);
    }
    return [CSV_HEADER, ...kept.slice(Math.max(0, kept.length - this.maxEntries()))];
  }

  private parseLine(line: string): HistoryEntry | null {
    const trimmed = line.trim();
    const comma = trimmed.indexOf(',');
    if (comma <= 0) return null;
    const timestamp = trimmed.slice(0, comma);
    const value = Number(trimmed.slice(comma + 1));
    if (!Number.isFinite(value)) return null;
    return { timestamp, value };
  }

  private timestampOf(line: string): string | undefined {
    return this.parseLine(line)?.timestamp;
  }

  private normalizePolicy(policy: string | undefined): string {
    const candidate = (policy ?? '').trim();
    return RETENTION_MS[candidate] ? candidate : DEFAULT_RETENTION_POLICY;
  }

  private normalizeLimit(limit: number, fallback: number): number {
    if (!Number.isFinite(limit) || limit <= 0) return fallback;
    return Math.min(Math.floor(limit), Number.MAX_SAFE_INTEGER);
  }

  onModuleDestroy(): void {
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.maintenanceTimer = null;
    this.flushToDisk();
  }
}
