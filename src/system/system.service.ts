import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as os from 'os';
import si from 'systeminformation';
import { LoggerService } from '../logger/logger.service';
import {
  SystemInfo,
  CpuInfo,
  CpuMetrics,
  CpuCoreMetrics,
  LoadAverage,
  MemoryMetrics,
  SwapMetrics,
  MemoryData,
  DiskInfo,
  DiskIoMetrics,
  DiskData,
  NetworkInterface,
  NetworkData,
  NetworkStatus,
  ProcessInfo,
  BatteryData,
  GpuData,
  RuntimeInfo,
  TemperatureData,
  UnsupportedMetric,
  MetricsSnapshot,
  HealthCheck,
} from './system.types';
import { getTimestamp } from '../common/utils/metrics.util';
import { TtlCache } from '../common/utils/ttl-cache';

// OS identity never changes while the process runs.
const STATIC_INFO_TTL_MS = 60 * 60 * 1000;
// Interface lists and filesystem sizes are expensive to probe and change rarely.
const NETWORK_INTERFACES_TTL_MS = 30_000;
const DEFAULT_FS_SIZE_TTL_MS = 10_000;
// `si.graphics()` shells out to system_profiler / nvidia-smi and can take seconds.
const GPU_TTL_MS = 10_000;
// Shared between the scheduler and REST calls so `ps` is not spawned once per caller.
const PROCESSES_TTL_MS = 1_000;

@Injectable()
export class SystemService {
  private readonly logger: any;
  private previousDiskIo: { readBytes: number; writeBytes: number; readOps: number; writeOps: number; timestamp: number } | null = null;
  private previousNetworkStats: Map<string, { rxBytes: number; txBytes: number; timestamp: number }> = new Map();
  private readonly cache = new TtlCache();
  private readonly fsSizeTtlMs: number;

  constructor(
    private readonly loggerService: LoggerService,
    @Optional() private readonly configService?: ConfigService,
  ) {
    this.logger = loggerService.child('SystemService');
    const diskInterval = this.configService?.get<number>('diskIntervalMs');
    this.fsSizeTtlMs =
      typeof diskInterval === 'number' && diskInterval > 0 ? Math.max(diskInterval, DEFAULT_FS_SIZE_TTL_MS) : DEFAULT_FS_SIZE_TTL_MS;
  }

  async getSystemInfo(): Promise<SystemInfo> {
    try {
      const osInfo = await this.cache.get('osInfo', STATIC_INFO_TTL_MS, () => si.osInfo());
      const time = si.time();

      return {
        hostname: os.hostname(),
        platform: os.platform(),
        platformVersion: os.release(),
        architecture: os.arch(),
        kernelVersion: os.release(),
        osVersion: osInfo.distro || os.type(),
        osRelease: osInfo.release || os.release(),
        machineType: osInfo.hostname || 'Unknown',
        uptime: os.uptime(),
        bootTime: new Date(time.uptime ? Date.now() - time.uptime * 1000 : Date.now()).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        virtualization: {
          virtual: false,
          platform: undefined,
        },
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to collect system info');
      throw error;
    }
  }

  async getCpuInfo(): Promise<CpuInfo> {
    try {
      const cpu = await this.cache.get('cpu', STATIC_INFO_TTL_MS, () => si.cpu());
      return {
        manufacturer: cpu.manufacturer || 'Unknown',
        brand: cpu.brand || 'Unknown',
        speed: cpu.speed || 0,
        minSpeed: cpu.speedMin || 0,
        maxSize: cpu.speedMax || 0,
        cores: cpu.cores || 0,
        physicalCores: cpu.physicalCores || 0,
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to collect CPU info');
      throw error;
    }
  }

  async getCpuMetrics(): Promise<CpuMetrics> {
    try {
      const currentLoad = await si.currentLoad();
      const loadavg = os.loadavg();

      const cores: CpuCoreMetrics[] = (currentLoad.cpus || []).map((cpu, index) => ({
        core: index,
        usage: Math.round(cpu.load * 10) / 10,
      }));

      return {
        usage: Math.round(currentLoad.currentLoad * 10) / 10,
        user: Math.round(currentLoad.currentLoadUser * 10) / 10,
        system: Math.round(currentLoad.currentLoadSystem * 10) / 10,
        idle: Math.round(currentLoad.currentLoadIdle * 10) / 10,
        nice: 0,
        cores,
        loadAverage: {
          oneMinute: Math.round(loadavg[0] * 100) / 100,
          fiveMinutes: Math.round(loadavg[1] * 100) / 100,
          fifteenMinutes: Math.round(loadavg[2] * 100) / 100,
        },
        temperature: { supported: false, value: null },
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to collect CPU metrics');
      throw error;
    }
  }

  async getMemoryMetrics(): Promise<MemoryData> {
    try {
      const mem = await si.mem();
      return {
        memory: {
          total: mem.total,
          used: mem.used,
          free: mem.free,
          available: mem.available,
          cached: mem.cached,
          buffers: mem.buffers,
          usagePercent: Math.round((mem.used / mem.total) * 1000) / 10,
        },
        swap: {
          total: mem.swaptotal,
          used: mem.swapused,
          free: mem.swapfree,
          usagePercent: mem.swaptotal > 0 ? Math.round((mem.swapused / mem.swaptotal) * 1000) / 10 : 0,
        },
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to collect memory metrics');
      throw error;
    }
  }

  async getDiskMetrics(): Promise<DiskData> {
    try {
      const [fsSize, diskIo, fsStats] = await Promise.all([
        this.cache.get('fsSize', this.fsSizeTtlMs, () => si.fsSize()),
        si.disksIO().catch(() => null),
        si.fsStats().catch(() => null),
      ]);

      const disks: DiskInfo[] = fsSize.map((fs) => ({
        device: fs.fs || 'Unknown',
        mount: fs.mount || '/',
        filesystem: fs.type || 'Unknown',
        total: fs.size,
        used: fs.used,
        available: fs.available,
        usagePercent: Math.round(fs.use * 10) / 10,
      }));

      const now = Date.now();
      // Bytes come from fsStats; disksIO only reports operation counts.
      const readBytes = fsStats?.rx || 0;
      const writeBytes = fsStats?.wx || 0;
      const readOps = diskIo?.rIO || 0;
      const writeOps = diskIo?.wIO || 0;

      const io: DiskIoMetrics = {
        readBytesPerSecond: 0,
        writeBytesPerSecond: 0,
        readOperationsPerSecond: 0,
        writeOperationsPerSecond: 0,
        totalReadBytes: readBytes,
        totalWriteBytes: writeBytes,
      };

      const prev = this.previousDiskIo;
      const elapsed = prev ? (now - prev.timestamp) / 1000 : 0;
      if (prev && elapsed > 0) {
        // Counters can reset (device reattached, wrap); never report negative rates.
        const rate = (current: number, previous: number) =>
          Math.max(0, Math.round((current - previous) / elapsed));
        io.readBytesPerSecond = rate(readBytes, prev.readBytes);
        io.writeBytesPerSecond = rate(writeBytes, prev.writeBytes);
        io.readOperationsPerSecond = rate(readOps, prev.readOps);
        io.writeOperationsPerSecond = rate(writeOps, prev.writeOps);
      }

      this.previousDiskIo = { readBytes, writeBytes, readOps, writeOps, timestamp: now };

      return { disks, io };
    } catch (error) {
      this.logger.error({ error }, 'Failed to collect disk metrics');
      throw error;
    }
  }

  async getNetworkMetrics(): Promise<NetworkData> {
    try {
      const [rawInterfaces, stats] = await Promise.all([
        this.cache.get('networkInterfaces', NETWORK_INTERFACES_TTL_MS, () => si.networkInterfaces()),
        si.networkStats(),
      ]);
      const interfaces = Array.isArray(rawInterfaces) ? rawInterfaces : [rawInterfaces];
      const statsByIface = new Map(stats.map((stat) => [stat.iface, stat]));

      const now = Date.now();
      const networkInterfaces: NetworkInterface[] = interfaces.map((iface) => {
        const stat = statsByIface.get(iface.iface);
        const prevStats = this.previousNetworkStats.get(iface.iface);

        let downloadBps = 0;
        let uploadBps = 0;

        if (prevStats && stat) {
          const timeDiff = (now - prevStats.timestamp) / 1000;
          if (timeDiff > 0) {
            downloadBps = Math.max(0, Math.round((stat.rx_bytes - prevStats.rxBytes) / timeDiff));
            uploadBps = Math.max(0, Math.round((stat.tx_bytes - prevStats.txBytes) / timeDiff));
          }
        }

        if (stat) {
          this.previousNetworkStats.set(iface.iface, {
            rxBytes: stat.rx_bytes,
            txBytes: stat.tx_bytes,
            timestamp: now,
          });
        }

        return {
          name: iface.iface,
          ip4: iface.ip4 || '',
          ip6: iface.ip6 || '',
          mac: iface.mac || '',
          operstate: iface.operstate || 'unknown',
          speed: iface.speed || 0,
          mtu: iface.mtu || 0,
          rxBytes: stat?.rx_bytes || 0,
          txBytes: stat?.tx_bytes || 0,
          rxPackets: (stat as any)?.rx_packets || 0,
          txPackets: (stat as any)?.tx_packets || 0,
          rxErrors: stat?.rx_errors || 0,
          txErrors: stat?.tx_errors || 0,
          downloadBytesPerSecond: downloadBps,
          uploadBytesPerSecond: uploadBps,
        };
      });

      return {
        interfaces: networkInterfaces,
        status: { internet: true, dns: true },
      };
    } catch (error) {
      this.logger.error({ error }, 'Failed to collect network metrics');
      throw error;
    }
  }

  async getProcesses(limit: number = 50, sort: string = 'cpu', search?: string): Promise<ProcessInfo[]> {
    try {
      const procs = await this.cache.get('processes', PROCESSES_TTL_MS, () => si.processes());
      let processes: ProcessInfo[] = procs.list.map((p) => ({
        pid: p.pid,
        name: p.name || 'Unknown',
        cpu: Math.round(p.cpu * 10) / 10,
        memory: Math.round(p.memRss * 1024), // memRss is reported in KB
        memoryPercent: Math.round(p.mem * 10) / 10,
        user: p.user || 'Unknown',
        parentPid: p.parentPid || 0,
        status: p.state || 'unknown',
        command: p.command || '',
        startTime: p.started ? new Date(p.started).toISOString() : undefined,
      }));

      if (search) {
        const searchLower = search.toLowerCase();
        processes = processes.filter(
          (p) =>
            p.name.toLowerCase().includes(searchLower) ||
            (p.command && p.command.toLowerCase().includes(searchLower)),
        );
      }

      processes.sort((a, b) => {
        if (sort === 'memory') return b.memory - a.memory;
        return b.cpu - a.cpu;
      });

      return processes.slice(0, limit);
    } catch (error) {
      this.logger.error({ error }, 'Failed to collect processes');
      throw error;
    }
  }

  async getProcessByPid(pid: number): Promise<ProcessInfo | undefined> {
    const all = await this.getProcesses(Number.MAX_SAFE_INTEGER, 'cpu');
    return all.find((p) => p.pid === pid);
  }

  async getBattery(): Promise<BatteryData> {
    try {
      const battery = await si.battery();
      if (!battery || battery.hasBattery === false) {
        return { supported: false };
      }
      return {
        supported: true,
        percentage: battery.percent || 0,
        charging: battery.isCharging || false,
        acConnected: battery.acConnected || false,
        remainingTime: battery.timeRemaining ? battery.timeRemaining * 60 : undefined,
        voltage: battery.voltage || undefined,
        current: battery.currentCapacity ? battery.currentCapacity / 1000 : undefined,
      };
    } catch (error) {
      this.logger.warn({ error }, 'Failed to collect battery info');
      return { supported: false };
    }
  }

  async getGpu(): Promise<GpuData> {
    try {
      const gpuInfo = await this.cache.get('graphics', GPU_TTL_MS, () => si.graphics());
      if (!gpuInfo.controllers || gpuInfo.controllers.length === 0) {
        return { supported: false, reason: 'GPU metrics unavailable on this system' };
      }

      const gpu = gpuInfo.controllers[0];
      return {
        supported: true,
        manufacturer: gpu.vendor || 'Unknown',
        model: gpu.model || 'Unknown',
        memory: gpu.vram ? gpu.vram * 1024 * 1024 : undefined,
        memoryUsed: typeof gpu.memoryUsed === 'number' ? gpu.memoryUsed : undefined,
        utilization: typeof gpu.utilizationGpu === 'number' ? gpu.utilizationGpu : undefined,
        temperature: typeof gpu.temperatureGpu === 'number' ? gpu.temperatureGpu : undefined,
        clockCore: typeof gpu.clockCore === 'number' ? gpu.clockCore : undefined,
        clockMemory: typeof gpu.clockMemory === 'number' ? gpu.clockMemory : undefined,
        powerUsage: typeof gpu.powerDraw === 'number' ? gpu.powerDraw : undefined,
      };
    } catch (error) {
      this.logger.warn({ error }, 'Failed to collect GPU info');
      return { supported: false, reason: 'GPU metrics unavailable on this system' };
    }
  }

  async getTemperature(): Promise<TemperatureData> {
    try {
      const temp = await si.cpuTemperature();
      if (!temp || (temp.cores || []).length === 0) {
        return { supported: false, value: null } as any;
      }
      return {
        supported: true,
        cpu: temp.main || undefined,
        sensors: (temp.cores || []).map((cpuTemp: number, i: number) => ({
          name: `CPU Core ${i}`,
          value: cpuTemp,
        })),
      };
    } catch (error) {
      this.logger.warn({ error }, 'Failed to collect temperature info');
      return { supported: false, value: null } as any;
    }
  }

  getRuntimeInfo(): RuntimeInfo {
    const memUsage = process.memoryUsage();
    return {
      nodeVersion: process.version,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers,
      },
    };
  }

  getHealth(): HealthCheck {
    return {
      status: 'ok',
      timestamp: getTimestamp(),
      uptime: Math.floor(process.uptime()),
      version: '1.0.0',
    };
  }

  async getMetricsSnapshot(): Promise<MetricsSnapshot> {
    const [cpu, memory, disk, network] = await Promise.all([
      this.getCpuMetrics(),
      this.getMemoryMetrics(),
      this.getDiskMetrics(),
      this.getNetworkMetrics(),
    ]);

    return {
      timestamp: getTimestamp(),
      cpu,
      memory,
      disk,
      network,
      runtime: this.getRuntimeInfo(),
    };
  }
}
