import { useEffect, useRef, useState } from "react";
import { formatMs } from "./model";
import { SPEEDS, defaultSpeed } from "./playback-clock";

interface Props {
  durationMs: number;
  /** Playhead in ms from the run start; undefined shows the whole run. */
  t?: number;
  onChange: (t: number | undefined) => void;
  /** Sorted span start offsets, for stepping span by span. */
  marks: number[];
}

/**
 * Playback is a clock filter over the store: spans that started by the playhead
 * are shown, open if they end after it. Rendering is the same as for live runs.
 */
export function Playback({ durationMs, t, onChange, marks }: Props) {
  const [playing, setPlaying] = useState(false);
  const reducedMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [speed, setSpeed] = useState(() => (reducedMotion ? SPEEDS[0] : defaultSpeed(durationMs)));
  const tRef = useRef(t);
  tRef.current = t;

  useEffect(() => setSpeed(reducedMotion ? SPEEDS[0] : defaultSpeed(durationMs)), [durationMs, reducedMotion]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = (tRef.current ?? 0) + (now - last) * speed;
      last = now;
      if (next >= durationMs) {
        onChange(durationMs);
        setPlaying(false);
        return;
      }
      onChange(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, durationMs, onChange]);

  const value = t ?? durationMs;
  const stepTo = (dir: 1 | -1) => {
    setPlaying(false);
    const cur = value;
    const next = dir > 0 ? marks.find((m) => m > cur + 1e-6) : [...marks].reverse().find((m) => m < cur - 1e-6);
    onChange(next ?? (dir > 0 ? durationMs : 0));
  };

  return (
    <div className="atv-playback" role="group" aria-label="Playback">
      <button
        type="button"
        className="atv-btn"
        onClick={() => {
          if (!playing && (t === undefined || t >= durationMs)) onChange(0);
          setPlaying(!playing);
        }}
        aria-pressed={playing}
      >
        {playing ? "Pause" : "Play"}
      </button>
      <button type="button" className="atv-btn" onClick={() => stepTo(-1)} aria-label="Previous span">
        ◀
      </button>
      <button type="button" className="atv-btn" onClick={() => stepTo(1)} aria-label="Next span">
        ▶
      </button>
      <input
        type="range"
        className="atv-scrub"
        min={0}
        max={durationMs}
        step="any"
        value={value}
        aria-label="Playback position"
        aria-valuetext={formatMs(value)}
        onChange={(e) => {
          setPlaying(false);
          onChange(Number(e.target.value));
        }}
      />
      <span className="atv-time">
        {formatMs(value)} / {formatMs(durationMs)}
      </span>
      <label className="atv-field">
        <span>Speed</span>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
      </label>
      {t !== undefined && (
        <button type="button" className="atv-btn" onClick={() => { setPlaying(false); onChange(undefined); }}>
          Show all
        </button>
      )}
    </div>
  );
}
