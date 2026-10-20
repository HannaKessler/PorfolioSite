import type { Run, TraceStore } from "../store/trace-store";

/** A readable name for a run: its source label, or brain, bug variant and start time. */
export function runLabel(store: TraceStore, run: Run): string {
  if (run.label) return run.label;
  const idx = store.index(run.id);
  const root = idx?.roots[0];
  const brain = String(root?.attrs["app.brain.label"] ?? "Run");
  const variant = root?.attrs["app.task.variant"];
  const time = idx ? new Date(Number(idx.startNs / 1_000_000n)).toLocaleTimeString() : "";
  return `${brain}${variant ? ` · ${variant} bug` : ""}${time ? ` · ${time}` : ""}`;
}
