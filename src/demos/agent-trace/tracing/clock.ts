import type { HrTime } from "@opentelemetry/api";

/** Milliseconds since the Unix epoch, with sub-millisecond precision. */
export type Clock = () => number;

/** The product clock: high-resolution and monotonic within a page or worker. */
export const realClock: Clock = () => performance.timeOrigin + performance.now();

export function toHrTime(ms: number): HrTime {
  const seconds = Math.floor(ms / 1000);
  const nanos = Math.round((ms - seconds * 1000) * 1e6);
  return nanos >= 1e9 ? [seconds + 1, nanos - 1e9] : [seconds, nanos];
}
