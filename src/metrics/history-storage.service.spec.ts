import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryStorageService } from './history-storage.service';

const loggerMock = {
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
} as any;

function createService(dir: string, overrides: Record<string, any> = {}): HistoryStorageService {
  const config = {
    get: (key: string, defaultValue?: any) => {
      const values: Record<string, any> = {
        historyDir: dir,
        historyRetentionPolicy: '1d',
        historyCacheEntries: 100,
        ...overrides,
      };
      return values[key] ?? defaultValue;
    },
  };
  return new HistoryStorageService(config as any, loggerMock);
}

function isoSecondsAgo(secondsAgo: number): string {
  return new Date(Date.now() - secondsAgo * 1000).toISOString();
}

describe('HistoryStorageService (CSV)', () => {
  let dir: string;
  let service: HistoryStorageService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-csv-'));
    service = createService(dir);
  });

  afterEach(() => {
    service.onModuleDestroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends samples to a CSV file instead of rewriting JSON', () => {
    service.append('cpu', isoSecondsAgo(2), 10.5);
    service.append('cpu', isoSecondsAgo(1), 20.5);
    service.flushToDisk();

    const csv = fs.readFileSync(path.join(dir, 'cpu.csv'), 'utf-8');
    expect(csv.startsWith('timestamp,value\n')).toBe(true);
    expect(csv.trim().split('\n')).toHaveLength(3);
    expect(fs.existsSync(path.join(dir, 'cpu.json'))).toBe(false);

    // A second flush appends, it must not rewrite the header or drop earlier rows.
    service.append('cpu', isoSecondsAgo(0), 30.5);
    service.flushToDisk();
    const appended = fs.readFileSync(path.join(dir, 'cpu.csv'), 'utf-8');
    expect(appended.match(/timestamp,value/g)).toHaveLength(1);
    expect(appended.trim().split('\n')).toHaveLength(4);
  });

  it('serves the newest entries with limit applied from the in-memory window', () => {
    for (let i = 0; i < 20; i++) service.append('cpu', isoSecondsAgo(100 - i), i);

    const history = service.getHistory('cpu', 5);
    expect(history).toHaveLength(5);
    expect(history.map((e) => e.value)).toEqual([15, 16, 17, 18, 19]);
    expect(fs.existsSync(path.join(dir, 'cpu.csv'))).toBe(false);
  });

  it('falls back to reading the CSV from disk for requests larger than the cache', () => {
    for (let i = 0; i < 300; i++) service.append('cpu', isoSecondsAgo(1000 - i), i);
    service.flushToDisk();

    const history = service.getHistory('cpu', 250);
    expect(history).toHaveLength(250);
    expect(history[0].value).toBe(50);
    expect(history[249].value).toBe(299);
  });

  it('reads a multi-chunk file backwards without duplicating or losing rows', () => {
    const total = 4000; // ~130KB of rows, so the reader needs several 64KB chunks
    for (let i = 0; i < total; i++) service.append('cpu', isoSecondsAgo(total + 5000 - i), i);
    service.flushToDisk();

    const history = service.getHistory('cpu', total);
    expect(history).toHaveLength(total);
    expect(history.map((e) => e.value)).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(new Set(history.map((e) => e.timestamp)).size).toBe(total);
  });

  it('filters by start and end time', () => {
    for (let i = 0; i < 200; i++) service.append('cpu', isoSecondsAgo(1000 - i * 5), i);
    service.flushToDisk();

    const start = isoSecondsAgo(500);
    const end = isoSecondsAgo(100);
    const history = service.getHistory('cpu', 1000, start, end);

    expect(history.length).toBeGreaterThan(1);
    expect(history.every((e) => e.timestamp >= start && e.timestamp <= end)).toBe(true);
    expect(history.map((e) => e.value)).toEqual([...history.map((e) => e.value)].sort((a, b) => a - b));
  });

  it('compacts rows that have aged out of the retention window', () => {
    for (let i = 0; i < 10; i++) service.append('cpu', isoSecondsAgo(3 * 86400 - i), i);
    for (let i = 0; i < 10; i++) service.append('cpu', isoSecondsAgo(60 - i), 100 + i);
    service.flushToDisk();
    expect(service.getStats().totalEntries).toBe(20);

    // Changing the policy re-checks retention and rewrites the file without the old rows.
    service.setRetentionPolicy('1d');

    const csv = fs.readFileSync(path.join(dir, 'cpu.csv'), 'utf-8');
    const rows = csv
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => Number(line.split(',')[1]));
    expect(rows).toHaveLength(10);
    expect(rows.every((value) => value >= 100)).toBe(true);
    expect(service.getStats().totalEntries).toBe(10);
    expect(service.getHistory('cpu', 100).map((e) => e.value)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107, 108, 109,
    ]);
  });

  it('clears history and removes the CSV file', () => {
    service.append('cpu', isoSecondsAgo(5), 1);
    service.flushToDisk();
    expect(fs.existsSync(path.join(dir, 'cpu.csv'))).toBe(true);

    service.clearHistory('cpu');

    expect(fs.existsSync(path.join(dir, 'cpu.csv'))).toBe(false);
    expect(service.getHistory('cpu', 10)).toEqual([]);
    expect(service.getStats().totalEntries).toBe(0);
  });

  it('exports CSV rows for a metric', () => {
    service.append('cpu', '2026-09-01T00:00:00.000Z', 1.5);
    service.append('cpu', '2026-09-01T00:00:01.000Z', 2.5);

    const csv = service.exportCsv('cpu');
    expect(csv.split('\n')).toEqual([
      'timestamp,value',
      '2026-09-01T00:00:00.000Z,1.5',
      '2026-09-01T00:00:01.000Z,2.5',
    ]);
  });

  it('caps getAllHistory per metric', () => {
    for (let i = 0; i < 50; i++) service.append('cpu', isoSecondsAgo(100 - i), i);

    const all = service.getAllHistory(5);
    expect(all.cpu).toHaveLength(5);
    expect(all.cpu[4].value).toBe(49);
    expect(all.memory).toEqual([]);
  });

  it('migrates an existing JSON history file on startup', () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-legacy-'));
    try {
      fs.writeFileSync(
        path.join(legacyDir, 'cpu.json'),
        JSON.stringify({
          metric: 'cpu',
          entries: [
            { timestamp: isoSecondsAgo(60), value: 11 },
            { timestamp: isoSecondsAgo(30), value: 22 },
          ],
        }),
        'utf-8',
      );

      const legacyService = createService(legacyDir);
      try {
        expect(legacyService.getHistory('cpu', 10).map((e) => e.value)).toEqual([11, 22]);
        expect(fs.existsSync(path.join(legacyDir, 'cpu.csv'))).toBe(true);
        expect(fs.existsSync(path.join(legacyDir, 'cpu.json'))).toBe(false);
        expect(fs.existsSync(path.join(legacyDir, 'cpu.json.legacy'))).toBe(true);
      } finally {
        legacyService.onModuleDestroy();
      }
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});

describe('HistoryStorageService metric validation', () => {
  let dir: string;
  let service: HistoryStorageService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-guard-'));
    service = createService(path.join(dir, 'history'));
  });

  afterEach(() => {
    service.onModuleDestroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('never deletes files outside the history directory', () => {
    const victim = path.join(dir, 'victim.csv');
    fs.writeFileSync(victim, 'timestamp,value\n');

    service.clearHistory('../victim' as any);

    expect(fs.existsSync(victim)).toBe(true);
  });

  it('never reads files outside the history directory', () => {
    fs.writeFileSync(path.join(dir, 'secret.csv'), `timestamp,value\n${new Date().toISOString()},42\n`);

    const history = service.getHistory('../secret' as any, 10, '1970-01-01T00:00:00.000Z');

    expect(history).toEqual([]);
  });
});
