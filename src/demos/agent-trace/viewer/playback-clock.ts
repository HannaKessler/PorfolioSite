/** Playback speeds, from 0.01× (sub-millisecond scripted steps become watchable) to 8×. */
export const SPEEDS = [0.01, 0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8];

/** The fastest speed at which playback still lasts at least `targetMs` of real time. */
export function defaultSpeed(durationMs: number, targetMs = 6000): number {
  const fitting = SPEEDS.filter((s) => durationMs / s >= targetMs);
  return fitting.length ? fitting[fitting.length - 1] : SPEEDS[0];
}
