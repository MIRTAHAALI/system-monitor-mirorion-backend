export default () => ({
  port: parseInt(process.env.PORT || '4000', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  metricsIntervalMs: parseInt(process.env.METRICS_INTERVAL_MS || '1000', 10),
  processIntervalMs: parseInt(process.env.PROCESS_INTERVAL_MS || '3000', 10),
  networkIntervalMs: parseInt(process.env.NETWORK_INTERVAL_MS || '1000', 10),
  diskIntervalMs: parseInt(process.env.DISK_INTERVAL_MS || '2000', 10),
  temperatureIntervalMs: parseInt(process.env.TEMPERATURE_INTERVAL_MS || '3000', 10),

  metricsHistorySize: parseInt(process.env.METRICS_HISTORY_SIZE || '300', 10),
  historyRetentionPolicy: process.env.HISTORY_RETENTION_POLICY || '1d',
  // Number of newest samples kept in memory per metric; older rows are read from CSV on demand.
  historyCacheEntries: parseInt(process.env.HISTORY_CACHE_ENTRIES || '5000', 10),

  enableGpuMonitoring: process.env.ENABLE_GPU_MONITORING !== 'false',
  enableBatteryMonitoring: process.env.ENABLE_BATTERY_MONITORING !== 'false',
  enableProcessMonitoring: process.env.ENABLE_PROCESS_MONITORING !== 'false',

  authEnabled: process.env.AUTH_ENABLED === 'true',
  jwtExpiresInSeconds: parseInt(process.env.JWT_EXPIRES_IN_SECONDS || String(7 * 24 * 60 * 60), 10),
  // Swagger UI defaults to on in development and off in production.
  enableSwagger:
    process.env.ENABLE_SWAGGER !== undefined
      ? process.env.ENABLE_SWAGGER === 'true'
      : process.env.NODE_ENV !== 'production',
});
