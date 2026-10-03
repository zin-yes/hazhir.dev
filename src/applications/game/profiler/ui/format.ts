const BYTES_PER_KIBIBYTE = 1024;
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatMilliseconds(milliseconds: number): string {
  if (!Number.isFinite(milliseconds)) return "-";
  const magnitude = Math.abs(milliseconds);
  if (magnitude >= 100) return `${milliseconds.toFixed(0)}ms`;
  if (magnitude >= 10) return `${milliseconds.toFixed(1)}ms`;
  return `${milliseconds.toFixed(2)}ms`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "-";
  let value = Math.abs(bytes);
  let unitIndex = 0;
  while (value >= BYTES_PER_KIBIBYTE && unitIndex < BYTE_UNITS.length - 1) {
    value /= BYTES_PER_KIBIBYTE;
    unitIndex++;
  }
  const sign = bytes < 0 ? "-" : "";
  const digits = unitIndex === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${sign}${value.toFixed(digits)}${BYTE_UNITS[unitIndex]}`;
}

export function formatBytesPerSecond(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatMillisecondsPerSecond(millisecondsPerSecond: number): string {
  if (!Number.isFinite(millisecondsPerSecond)) return "-";
  return `${millisecondsPerSecond.toFixed(millisecondsPerSecond >= 100 ? 0 : 1)}ms/s`;
}

export function formatCount(count: number): string {
  if (!Number.isFinite(count)) return "-";
  if (Math.abs(count) >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (Math.abs(count) >= 10_000) return `${(count / 1000).toFixed(1)}k`;
  return Number.isInteger(count) ? `${count}` : count.toFixed(1);
}

export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction)) return "-";
  return `${(fraction * 100).toFixed(fraction >= 0.995 ? 0 : 1)}%`;
}

export function formatNanosecondsPerUnit(nanoseconds: number): string {
  if (!Number.isFinite(nanoseconds)) return "-";
  if (nanoseconds >= 1_000_000) return `${(nanoseconds / 1_000_000).toFixed(2)}ms`;
  if (nanoseconds >= 1000) return `${(nanoseconds / 1000).toFixed(2)}us`;
  return `${nanoseconds.toFixed(0)}ns`;
}

export function formatOptional<Value>(
  value: Value | null | undefined,
  format: (value: Value) => string,
): string {
  return value === null || value === undefined ? "-" : format(value);
}
