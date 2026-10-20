import { createStore, del, entries, set, type UseStore } from "idb-keyval";
import type { OtlpExportRequest } from "../collector/normalize";
import type { RunSource } from "./trace-store";

/** A persisted run: the OTLP-JSON export plus how it entered the store. */
export interface StoredRun {
  runId: string;
  source: RunSource;
  label?: string;
  savedAt: number;
  otlp: OtlpExportRequest;
}

let store: UseStore | undefined;
const db = (): UseStore | undefined => {
  if (typeof indexedDB === "undefined") return undefined;
  store ??= createStore("agent-trace-viewer", "runs");
  return store;
};

/** Saves a completed run so it survives a reload. Data never leaves the browser. */
export async function saveRun(run: StoredRun): Promise<void> {
  const s = db();
  if (s) await set(run.runId, run, s);
}

export async function loadRuns(): Promise<StoredRun[]> {
  const s = db();
  if (!s) return [];
  return (await entries<string, StoredRun>(s)).map(([, v]) => v).sort((a, b) => a.savedAt - b.savedAt);
}

export async function deleteRun(runId: string): Promise<void> {
  const s = db();
  if (s) await del(runId, s);
}
