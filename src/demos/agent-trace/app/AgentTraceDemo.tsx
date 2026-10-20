import { useEffect, useState } from "react";
import { AgentClient } from "../agent/client";
import { Collector } from "../collector/collector";
import { TraceStore } from "../store/trace-store";
import { loadRuns } from "../store/idb";
import { TraceViewer } from "../viewer/TraceViewer";
import { RunPanel } from "./RunPanel";
import { loadSamples } from "./samples";

const store = new TraceStore();
const collector = new Collector(store);
let client: AgentClient | undefined;
const getClient = () => (client ??= new AgentClient());

let booted = false;
async function boot() {
  if (booted) return;
  booted = true;
  await loadSamples(collector);
  for (const saved of await loadRuns().catch(() => [])) {
    try {
      collector.ingest(saved.otlp, { source: saved.source, sourceId: saved.runId, label: saved.label });
    } catch (e) {
      console.warn("Skipping a saved run that no longer parses:", e);
    }
  }
}

/** The demo island: run controls on top, the trace monitor below. */
export default function AgentTraceDemo() {
  const [focus, setFocus] = useState<{ runId: string; nonce: number }>();
  useEffect(() => {
    void boot();
  }, []);
  return (
    <div className="atv-app">
      <TraceViewer store={store} collector={collector} focus={focus}>
        <RunPanel client={getClient} store={store} collector={collector} onRunStarted={(runId) => setFocus({ runId, nonce: Date.now() })} />
      </TraceViewer>
    </div>
  );
}
