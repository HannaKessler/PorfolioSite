import type { Connection } from "../../filmgraph/client/connection";
import type { BootStatus } from "../../filmgraph/protocol";
import { formatBytes, formatCount, formatMs } from "../../filmgraph/client/metrics";

interface Props {
  status: BootStatus | null;
  connection: Connection | null;
  onReset: () => void;
}

const STEPS: { phase: BootStatus["phase"]; label: string }[] = [
  { phase: "engine", label: "Start Postgres" },
  { phase: "download", label: "Download data" },
  { phase: "seed", label: "Load tables" },
  { phase: "ready", label: "Ready" },
];

export function BootBanner({ status, connection, onReset }: Props) {
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
        <div className="fg-spinner" aria-hidden="true" />
        <div>
          <strong>Setting up your private copy of the database…</strong>
          <p>
            {status?.detail ?? "Starting the backend worker"}. The first visit downloads Postgres (about 4 MB compressed)
            and the film data, then later visits start from a copy saved in your browser.
          </p>
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
  return (
    <div className="fg-banner fg-banner-ready" role="status" aria-live="polite">
      <p>
        <strong>Postgres is running in your browser.</strong> {formatCount(status.counts?.films ?? 0)} films,{" "}
        {formatCount(status.counts?.people ?? 0)} people and {formatCount(status.counts?.credits ?? 0)} credits, ready in{" "}
        {formatMs(status.elapsedMs)}
        {status.seeded
          ? ` (first visit: loaded ${formatBytes(status.seedBytes ?? 0)} of seed data).`
          : " (restored from the copy saved in this browser)."}{" "}
        {connection.mode === "service-worker"
          ? "Requests go through a service worker, so you can watch them in your browser's Network tab."
          : `${connection.fallbackReason} Requests go straight to the backend worker instead, with the same Request and Response objects.`}
      </p>
      <button type="button" className="fg-link-button" onClick={onReset}>
        Reset local database
      </button>
    </div>
  );
}
