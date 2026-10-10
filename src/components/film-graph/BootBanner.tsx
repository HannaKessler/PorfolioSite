import type { Connection } from "../../filmgraph/client/connection";
import type { BootStatus } from "../../filmgraph/protocol";
import { formatBytes, formatCount, formatMs } from "../../filmgraph/client/metrics";

interface Props {
  status: BootStatus | null;
  connection: Connection | null;
  /** False until the visitor first presses Run or types a name. */
  started: boolean;
  onReset: () => void;
}

const STEPS: { phase: BootStatus["phase"]; label: string }[] = [
  { phase: "engine", label: "Start Postgres" },
  { phase: "download", label: "Download data" },
  { phase: "seed", label: "Load tables" },
  { phase: "ready", label: "Ready" },
];

export function BootBanner({ status, connection, started, onReset }: Props) {
  // No banner before the visitor does anything, and none once the database is ready.
  if (!started || !status) return null;
  if (status?.phase === "error") {
    return (
      <div className="fg-banner fg-banner-error" role="alert">
        <strong>The in-browser database could not start.</strong> {status.detail} Try reloading the page. The demo needs
        a recent browser with WebAssembly, Web Workers and IndexedDB.
      </div>
    );
  }
  if (status?.phase !== "ready" || !connection) {
    const current = STEPS.findIndex((step) => step.phase === (status?.phase ?? "engine"));
    return (
      <div className="fg-banner" role="status" aria-live="polite">
        <div>
          <strong>Setting up your private copy of the database…</strong>
          <p>
            {status?.detail ?? "Starting the backend worker"}. The first visit downloads Postgres and the film data (about
            11 MB compressed in total). Later visits start from a copy saved in your browser.
          </p>
          {status?.progress !== undefined && (
            <progress className="fg-boot-progress" value={status.progress} max={1} aria-label="Setup progress">
              {Math.round(status.progress * 100)}%
            </progress>
          )}
          <ol className="fg-boot-steps">
            {STEPS.map((step, index) => (
              <li key={step.phase} data-state={index < current ? "done" : index === current ? "active" : "todo"}>
                {step.label}
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }
  return null;
}

/** One quiet line under the hood once the database is ready: what's running, and a reset link. */
export function EngineNote({ status, connection, onReset }: Omit<Props, "started">) {
  if (status?.phase !== "ready" || !connection) return null;
  return (
    <p className="fg-engine-note">
      <span>
        Postgres is running in your browser: {formatCount(status.counts?.films ?? 0)} films,{" "}
        {formatCount(status.counts?.people ?? 0)} people and {formatCount(status.counts?.credits ?? 0)} credits, ready in{" "}
        {formatMs(status.elapsedMs)}
        {status.seeded
          ? ` (first visit: loaded ${formatBytes(status.seedBytes ?? 0)} of seed data).`
          : " (restored from the copy saved in this browser)."}{" "}
        {connection.mode === "service-worker"
          ? "Requests go through a service worker, so you can watch them in your browser's Network tab."
          : `${connection.fallbackReason} Requests go straight to the backend worker instead, with the same Request and Response objects.`}
      </span>{" "}
      <button type="button" className="fg-link-button" onClick={onReset}>
        Reset local database
      </button>
    </p>
  );
}
