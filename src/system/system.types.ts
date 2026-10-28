export interface SystemInfo {
  hostname: string;
  platform: string;
  platformVersion: string;
  architecture: string;
  kernelVersion: string;
  osVersion: string;
  osRelease: string;
  machineType: string;
  uptime: number;
  bootTime: string;
  timezone: string;
  locale: string;
  virtualization: VirtualizationInfo;
}

export interface VirtualizationInfo {
  virtual: boolean;
  platform?: string;
}

export interface UnsupportedMetric {
  supported: false;
  value: null;
  reason?: string;
}

export interface CpuInfo {
  manufacturer: string;
  brand: string;
  speed: number;
  minSpeed: number;
  maxSize: number;
  cores: number;
  physicalCores: number;
}

export interface CpuMetrics {
  usage: number;
  user: number;
  system: number;
  idle: number;
  nice: number;
  cores: CpuCoreMetrics[];
  loadAverage: LoadAverage;
  temperature: UnsupportedMetric | TemperatureData;
}

export interface CpuCoreMetrics {
  core: number;
  usage: number;
}

export interface LoadAverage {
  oneMinute: number;
  fiveMinutes: number;
  fifteenMinutes: number;
}

export interface TemperatureData {
  supported: true;
  cpu?: number;
  gpu?: number;
  motherboard?: number;
  fanSpeed?: number;
  sensors?: TemperatureSensor[];
}

export interface TemperatureSensor {
  name: string;
  value: number;
}

export interface MemoryMetrics {
  total: number;
  used: number;
  free: number;
  available: number;
  cached?: number;
  buffers?: number;
  usagePercent: number;
}

export interface SwapMetrics {
  total: number;
  used: number;
  free: number;
  usagePercent: number;
}

export interface MemoryData {
  memory: MemoryMetrics;
  swap: SwapMetrics;
}

export interface DiskInfo {
  device: string;
  mount: string;
  filesystem: string;
  total: number;
  used: number;
  available: number;
  usagePercent: number;
}

export interface DiskIoMetrics {
  readBytesPerSecond: number;
  writeBytesPerSecond: number;
  readOperationsPerSecond: number;
  writeOperationsPerSecond: number;
  totalReadBytes: number;
  totalWriteBytes: number;
}

export interface DiskData {
  disks: DiskInfo[];
  io: DiskIoMetrics;
}

export interface NetworkInterface {
  name: string;
  ip4: string;
  ip6: string;
  mac: string;
  operstate: string;
  speed: number;
  mtu: number;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
  rxErrors: number;
  txErrors: number;
  downloadBytesPerSecond: number;
  uploadBytesPerSecond: number;
}

export interface NetworkStatus {
  internet: boolean;
  dns: boolean;
  defaultGateway?: string;
  activeInterface?: string;
}

export interface NetworkData {
  interfaces: NetworkInterface[];
  status: NetworkStatus;
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  memory: number;
  memoryPercent: number;
  user: string;
  parentPid: number;
  status: string;
  command?: string;
  startTime?: string;
}

export interface BatteryData {
  supported: boolean;
  percentage?: number;
  charging?: boolean;
  acConnected?: boolean;
  remainingTime?: number;
  voltage?: number;
  current?: number;
}

export interface GpuData {
  supported: boolean;
  manufacturer?: string;
  model?: string;
  memory?: number;
  memoryUsed?: number;
  utilization?: number;
  temperature?: number;
  clockCore?: number;
  clockMemory?: number;
  powerUsage?: number;
  reason?: string;
}

export interface RuntimeInfo {
  nodeVersion: string;
  npmVersion?: string;
  pid: number;
  uptime: number;
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers?: number;
  };
}

export interface MetricsSnapshot {
  timestamp: string;
  cpu: CpuMetrics;
  memory: MemoryData;
  disk: DiskData;
  network: NetworkData;
  runtime: RuntimeInfo;
  battery?: BatteryData;
  gpu?: GpuData;
  temperature?: TemperatureData;
}

export interface HealthCheck {
  status: string;
  timestamp: string;
  uptime: number;
  version: string;
}

export interface SocketStatus {
  connectedClients: number;
  status: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface MetricsHistoryPoint {
  timestamp: string;
  value: number;
}
