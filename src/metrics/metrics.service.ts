import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SystemService } from '../system/system.service';
import { SystemGateway } from '../system/system.gateway';
import { LoggerService } from '../logger/logger.service';
import { HistoryStorageService } from './history-storage.service';
import { MetricsSnapshot } from '../system/system.types';
import { getTimestamp } from '../common/utils/metrics.util';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  private latestMetrics: MetricsSnapshot | null = null;
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly systemService: SystemService,
    private readonly gateway: SystemGateway,
    private readonly loggerService: LoggerService,
    private readonly configService: ConfigService,
    private readonly historyStorage: HistoryStorageService,
  ) {}

  async collectAndBroadcast(): Promise<void> {
    try {
      const snapshot = await this.systemService.getMetricsSnapshot();
      this.latestMetrics = snapshot;

      const ts = snapshot.timestamp;
      this.historyStorage.append('cpu', ts, snapshot.cpu.usage);
      this.historyStorage.append('memory', ts, snapshot.memory.memory.usagePercent);
      this.historyStorage.append('disk', ts, snapshot.disk.disks[0]?.usagePercent || 0);

      const totalDownload = snapshot.network.interfaces.reduce(
        (sum, iface) => sum + iface.downloadBytesPerSecond, 0,
      );
      const totalUpload = snapshot.network.interfaces.reduce(
        (sum, iface) => sum + iface.uploadBytesPerSecond, 0,
      );
      this.historyStorage.append('networkDownload', ts, totalDownload);
      this.historyStorage.append('networkUpload', ts, totalUpload);

      // The snapshot already carries cpu/memory/disk/network/runtime, so it is the only
      // per-tick event; sending each section again doubled the socket traffic.
      if (this.gateway.hasClients()) {
        this.gateway.broadcastSnapshot(snapshot);
      }
    } catch (error) {
      this.loggerService.error('Failed to collect and broadcast metrics', 'MetricsService');
    }
  }

  async collectProcesses(): Promise<void> {
    // Process lists are expensive to build and are not stored in history.
    if (!this.gateway.hasClients()) return;
    try {
      const processes = await this.systemService.getProcesses(20, 'cpu');
      this.gateway.broadcastMetrics('processes:update', {
        timestamp: getTimestamp(),
        processes,
      });
    } catch (error) {
      this.loggerService.error('Failed to collect processes', 'MetricsService');
    }
  }

  async collectExtended(): Promise<void> {
    try {
      const ts = getTimestamp();
      // A disabled probe settles as rejected, so nothing is broadcast or stored for it.
      const disabled = () => Promise.reject(new Error('disabled'));
      const [battery, gpu, temperature] = await Promise.allSettled([
        this.configService.get<boolean>('enableBatteryMonitoring', true)
          ? this.systemService.getBattery()
          : disabled(),
        this.configService.get<boolean>('enableGpuMonitoring', true)
          ? this.systemService.getGpu()
          : disabled(),
        this.systemService.getTemperature(),
      ]);

      if (battery.status === 'fulfilled') {
        this.gateway.broadcastMetrics('battery:update', { timestamp: ts, battery: battery.value });
        if (battery.value.supported && typeof battery.value.percentage === 'number') {
          this.historyStorage.append('battery', ts, battery.value.percentage);
        }
      }
      if (gpu.status === 'fulfilled') {
        this.gateway.broadcastMetrics('gpu:update', { timestamp: ts, gpu: gpu.value });
        if (gpu.value.supported && typeof gpu.value.utilization === 'number') {
          this.historyStorage.append('gpu', ts, gpu.value.utilization);
        }
      }
      if (temperature.status === 'fulfilled') {
        this.gateway.broadcastMetrics('temperature:update', { timestamp: ts, temperature: temperature.value });
        if (temperature.value.supported && typeof temperature.value.cpu === 'number') {
          this.historyStorage.append('temperature', ts, temperature.value.cpu);
        }
      }
    } catch (error) {
      this.loggerService.error('Failed to collect extended metrics', 'MetricsService');
    }
  }

  getLatestMetrics(): MetricsSnapshot | null {
    return this.latestMetrics;
  }

  getHistory(metric: string, limit: number = 100, startTime?: string, endTime?: string) {
    return this.historyStorage.getHistory(metric as any, limit, startTime, endTime);
  }

  startCollecting(): void {
    if (this.running) return;
    this.running = true;

    const metricsInterval = this.intervalFromConfig('metricsIntervalMs', 1000);
    const processInterval = this.intervalFromConfig('processIntervalMs', 3000);
    const extendedInterval = this.intervalFromConfig('temperatureIntervalMs', 3000);

    this.loop(() => this.collectAndBroadcast(), metricsInterval);
    if (this.configService.get<boolean>('enableProcessMonitoring', true)) {
      this.loop(() => this.collectProcesses(), processInterval);
    }
    this.loop(() => this.collectExtended(), extendedInterval);
  }

  stopCollecting(): void {
    this.running = false;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers = [];
  }

  /**
   * Runs `task` now and then every `intervalMs`, but never starts a run while the previous
   * one is still going: a slow probe delays the next tick instead of piling up calls.
   */
  private loop(task: () => Promise<void>, intervalMs: number): void {
    const run = async () => {
      const startedAt = Date.now();
      await task();
      if (!this.running) return;
      const delay = Math.max(0, intervalMs - (Date.now() - startedAt));
      this.timers = this.timers.filter((t) => t !== timer);
      timer = setTimeout(run, delay);
      this.timers.push(timer);
    };
    let timer = setTimeout(run, 0);
    this.timers.push(timer);
  }

  private intervalFromConfig(key: string, fallback: number): number {
    const value = this.configService.get<number>(key, fallback);
    // Guard against 0/NaN from a bad env var turning the loop into a busy spin.
    return Number.isFinite(value) && value >= 100 ? value : fallback;
  }

  onModuleDestroy(): void {
    this.stopCollecting();
  }
}
