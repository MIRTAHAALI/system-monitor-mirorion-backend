import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MetricsService } from './metrics.service';
import { HistoryStorageService } from './history-storage.service';
import { SystemService } from '../system/system.service';
import { SystemGateway } from '../system/system.gateway';
import { LoggerService } from '../logger/logger.service';

describe('MetricsService', () => {
  let service: MetricsService;

  const mockSystemService = {
    getMetricsSnapshot: jest.fn().mockResolvedValue({
      timestamp: new Date().toISOString(),
      cpu: { usage: 50, cores: [], loadAverage: { oneMinute: 1, fiveMinutes: 1, fifteenMinutes: 1 } },
      memory: { memory: { usagePercent: 50, total: 16000000000 }, swap: { total: 0 } },
      disk: { disks: [{ usagePercent: 50 }], io: {} },
      network: { interfaces: [{ downloadBytesPerSecond: 100, uploadBytesPerSecond: 50 }] },
      runtime: { nodeVersion: 'v20', pid: 1, uptime: 100, memory: { rss: 1000, heapTotal: 1000, heapUsed: 500, external: 100 } },
    }),
    getProcesses: jest.fn().mockResolvedValue([]),
    getBattery: jest.fn().mockResolvedValue({ supported: false }),
    getGpu: jest.fn().mockResolvedValue({ supported: false }),
    getTemperature: jest.fn().mockResolvedValue({ supported: false }),
  };

  const mockGateway = {
    broadcastSnapshot: jest.fn(),
    broadcastMetrics: jest.fn(),
    getConnectedClients: jest.fn().mockReturnValue(1),
    hasClients: jest.fn().mockReturnValue(true),
    getStatus: jest.fn().mockReturnValue('healthy'),
  };

  const mockHistoryStorage = {
    append: jest.fn(),
    getHistory: jest.fn().mockReturnValue([]),
    flushToDisk: jest.fn(),
    clearHistory: jest.fn(),
    getAllHistory: jest.fn().mockReturnValue({}),
    getStats: jest.fn().mockReturnValue({ metrics: [], totalEntries: 0, retentionPolicy: '1d' }),
    setRetentionPolicy: jest.fn(),
    getRetentionPolicy: jest.fn().mockReturnValue('1d'),
    exportCsv: jest.fn().mockReturnValue('timestamp,value'),
    exportAllCsv: jest.fn().mockReturnValue('timestamp,cpu'),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: any) => {
      const config: Record<string, any> = {
        metricsHistorySize: 300,
        metricsIntervalMs: 1000,
        processIntervalMs: 3000,
        diskIntervalMs: 2000,
      };
      return config[key] ?? defaultValue;
    }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: SystemService, useValue: mockSystemService },
        { provide: SystemGateway, useValue: mockGateway },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: HistoryStorageService, useValue: mockHistoryStorage },
        LoggerService,
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('collectAndBroadcast', () => {
    it('should collect metrics and broadcast', async () => {
      await service.collectAndBroadcast();
      expect(mockSystemService.getMetricsSnapshot).toHaveBeenCalled();
      expect(mockGateway.broadcastSnapshot).toHaveBeenCalled();
      expect(mockHistoryStorage.append).toHaveBeenCalled();
    });

    it('sends the snapshot once instead of repeating each section', async () => {
      await service.collectAndBroadcast();
      expect(mockGateway.broadcastSnapshot).toHaveBeenCalledTimes(1);
      expect(mockGateway.broadcastMetrics).not.toHaveBeenCalled();
    });

    it('still records history when nobody is connected', async () => {
      mockGateway.hasClients.mockReturnValueOnce(false);
      await service.collectAndBroadcast();
      expect(mockGateway.broadcastSnapshot).not.toHaveBeenCalled();
      expect(mockHistoryStorage.append).toHaveBeenCalled();
    });
  });

  describe('collectProcesses', () => {
    it('skips the process scan when nobody is connected', async () => {
      mockGateway.hasClients.mockReturnValueOnce(false);
      await service.collectProcesses();
      expect(mockSystemService.getProcesses).not.toHaveBeenCalled();
    });
  });

  describe('startCollecting', () => {
    afterEach(() => {
      service.stopCollecting();
      jest.useRealTimers();
    });

    it('does not start a new run while the previous one is still in flight', async () => {
      jest.useFakeTimers();
      let release: () => void = () => undefined;
      mockSystemService.getMetricsSnapshot.mockImplementationOnce(
        () => new Promise((resolve) => {
          release = () => resolve({
            timestamp: new Date().toISOString(),
            cpu: { usage: 1 },
            memory: { memory: { usagePercent: 1 } },
            disk: { disks: [] },
            network: { interfaces: [] },
            runtime: {},
          });
        }),
      );

      service.startCollecting();
      await jest.advanceTimersByTimeAsync(5000);
      // The first snapshot is still pending, so no further collection may have started.
      expect(mockSystemService.getMetricsSnapshot).toHaveBeenCalledTimes(1);

      // The overdue run starts as soon as the slow one finishes, then the normal cadence resumes.
      release();
      await jest.advanceTimersByTimeAsync(0);
      expect(mockSystemService.getMetricsSnapshot).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1000);
      expect(mockSystemService.getMetricsSnapshot).toHaveBeenCalledTimes(3);
    });
  });

  describe('getHistory', () => {
    it('should return history from storage', () => {
      const history = service.getHistory('cpu');
      expect(history).toEqual([]);
      expect(mockHistoryStorage.getHistory).toHaveBeenCalledWith('cpu', 100, undefined, undefined);
    });
  });

  describe('getLatestMetrics', () => {
    it('should return null initially', () => {
      expect(service.getLatestMetrics()).toBeNull();
    });

    it('should return metrics after collection', async () => {
      await service.collectAndBroadcast();
      const metrics = service.getLatestMetrics();
      expect(metrics).not.toBeNull();
    });
  });
});
