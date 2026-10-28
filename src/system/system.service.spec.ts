import { Test, TestingModule } from '@nestjs/testing';
import { SystemService } from './system.service';
import { LoggerService } from '../logger/logger.service';

describe('SystemService', () => {
  let service: SystemService;
  let loggerService: LoggerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SystemService,
        LoggerService,
      ],
    }).compile();

    service = module.get<SystemService>(SystemService);
    loggerService = module.get<LoggerService>(LoggerService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getSystemInfo', () => {
    it('should return system information', async () => {
      const info = await service.getSystemInfo();
      expect(info).toBeDefined();
      expect(info.hostname).toBeDefined();
      expect(info.platform).toBeDefined();
      expect(info.architecture).toBeDefined();
      expect(info.uptime).toBeGreaterThan(0);
    });
  });

  describe('getCpuInfo', () => {
    it('should return CPU information', async () => {
      const info = await service.getCpuInfo();
      expect(info).toBeDefined();
      expect(info.cores).toBeGreaterThan(0);
      expect(info.physicalCores).toBeGreaterThan(0);
    });
  });

  describe('getCpuMetrics', () => {
    it('should return CPU metrics', async () => {
      const metrics = await service.getCpuMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.usage).toBeGreaterThanOrEqual(0);
      expect(metrics.usage).toBeLessThanOrEqual(100);
      expect(metrics.cores).toBeDefined();
      expect(Array.isArray(metrics.cores)).toBe(true);
      expect(metrics.loadAverage).toBeDefined();
      expect(metrics.loadAverage.oneMinute).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getMemoryMetrics', () => {
    it('should return memory metrics', async () => {
      const metrics = await service.getMemoryMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.memory.total).toBeGreaterThan(0);
      expect(metrics.memory.used).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.usagePercent).toBeGreaterThanOrEqual(0);
      expect(metrics.memory.usagePercent).toBeLessThanOrEqual(100);
      expect(metrics.swap).toBeDefined();
    });
  });

  describe('getDiskMetrics', () => {
    it('should return disk metrics', async () => {
      const metrics = await service.getDiskMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.disks).toBeDefined();
      expect(Array.isArray(metrics.disks)).toBe(true);
      expect(metrics.disks.length).toBeGreaterThan(0);
      expect(metrics.io).toBeDefined();
    });
  });

  describe('getNetworkMetrics', () => {
    it('should return network metrics', async () => {
      const metrics = await service.getNetworkMetrics();
      expect(metrics).toBeDefined();
      expect(metrics.interfaces).toBeDefined();
      expect(Array.isArray(metrics.interfaces)).toBe(true);
      expect(metrics.status).toBeDefined();
    });
  });

  describe('getProcesses', () => {
    it('should return processes', async () => {
      const processes = await service.getProcesses(10, 'cpu');
      expect(processes).toBeDefined();
      expect(Array.isArray(processes)).toBe(true);
      expect(processes.length).toBeLessThanOrEqual(10);
    });

    it('should filter by search', async () => {
      const processes = await service.getProcesses(50, 'cpu', 'node');
      expect(processes).toBeDefined();
      processes.forEach(p => {
        expect(
          p.name.toLowerCase().includes('node') ||
          (p.command && p.command.toLowerCase().includes('node'))
        ).toBe(true);
      });
    });
  });

  describe('getBattery', () => {
    it('should return battery info', async () => {
      const battery = await service.getBattery();
      expect(battery).toBeDefined();
      expect(typeof battery.supported).toBe('boolean');
    });
  });

  describe('getGpu', () => {
    it('should return GPU info', async () => {
      const gpu = await service.getGpu();
      expect(gpu).toBeDefined();
      expect(typeof gpu.supported).toBe('boolean');
    });
  });

  describe('getRuntimeInfo', () => {
    it('should return runtime info', () => {
      const info = service.getRuntimeInfo();
      expect(info).toBeDefined();
      expect(info.nodeVersion).toBeDefined();
      expect(info.pid).toBeGreaterThan(0);
      expect(info.uptime).toBeGreaterThanOrEqual(0);
      expect(info.memory).toBeDefined();
      expect(info.memory.rss).toBeGreaterThan(0);
      expect(info.memory.heapTotal).toBeGreaterThan(0);
    });
  });

  describe('getHealth', () => {
    it('should return health status', () => {
      const health = service.getHealth();
      expect(health).toBeDefined();
      expect(health.status).toBe('ok');
      expect(health.timestamp).toBeDefined();
      expect(health.uptime).toBeGreaterThanOrEqual(0);
      expect(health.version).toBe('1.0.0');
    });
  });

  describe('getMetricsSnapshot', () => {
    it('should return complete metrics snapshot', async () => {
      const snapshot = await service.getMetricsSnapshot();
      expect(snapshot).toBeDefined();
      expect(snapshot.timestamp).toBeDefined();
      expect(snapshot.cpu).toBeDefined();
      expect(snapshot.memory).toBeDefined();
      expect(snapshot.disk).toBeDefined();
      expect(snapshot.network).toBeDefined();
      expect(snapshot.runtime).toBeDefined();
    });
  });
});
