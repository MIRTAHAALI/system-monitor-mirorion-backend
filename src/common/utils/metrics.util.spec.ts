import { formatBytes, formatBytesPerSecond, formatPercentage, formatDuration, formatTemperature, formatSpeed, getTimestamp, clampNumber } from './metrics.util';

describe('Metrics Utilities', () => {
  describe('formatBytes', () => {
    it('should format 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('should format bytes', () => {
      expect(formatBytes(100)).toBe('100 B');
    });

    it('should format kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
    });

    it('should format megabytes', () => {
      expect(formatBytes(1048576)).toBe('1 MB');
    });

    it('should format gigabytes', () => {
      expect(formatBytes(1073741824)).toBe('1 GB');
    });

    it('should format terabytes', () => {
      expect(formatBytes(1099511627776)).toBe('1 TB');
    });
  });

  describe('formatBytesPerSecond', () => {
    it('should format bytes per second', () => {
      expect(formatBytesPerSecond(1048576)).toBe('1 MB/s');
    });
  });

  describe('formatPercentage', () => {
    it('should format percentage', () => {
      expect(formatPercentage(45.7)).toBe('45.7%');
    });

    it('should format whole numbers', () => {
      expect(formatPercentage(100)).toBe('100.0%');
    });
  });

  describe('formatDuration', () => {
    it('should format seconds only', () => {
      expect(formatDuration(30)).toBe('30s');
    });

    it('should format minutes and seconds', () => {
      expect(formatDuration(90)).toBe('1m 30s');
    });

    it('should format hours, minutes and seconds', () => {
      expect(formatDuration(3661)).toBe('1h 1m 1s');
    });

    it('should format days, hours, minutes and seconds', () => {
      expect(formatDuration(90061)).toBe('1d 1h 1m 1s');
    });
  });

  describe('formatTemperature', () => {
    it('should format temperature', () => {
      expect(formatTemperature(45.6)).toBe('45.6°C');
    });
  });

  describe('formatSpeed', () => {
    it('should format speed', () => {
      expect(formatSpeed(3200)).toBe('3200 MHz');
    });
  });

  describe('getTimestamp', () => {
    it('should return ISO 8601 timestamp', () => {
      const timestamp = getTimestamp();
      expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('clampNumber', () => {
    it('should clamp to min', () => {
      expect(clampNumber(-10, 0, 100)).toBe(0);
    });

    it('should clamp to max', () => {
      expect(clampNumber(150, 0, 100)).toBe(100);
    });

    it('should not clamp within range', () => {
      expect(clampNumber(50, 0, 100)).toBe(50);
    });
  });
});
