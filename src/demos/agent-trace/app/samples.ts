import type { Collector } from "../collector/collector";

/** Recorded sample traces, bundled as separate chunks and fetched after the page loads. */
const modules = import.meta.glob<{ default: unknown }>("../samples/*.otlp.json");

export const SAMPLE_LABELS: Record<string, string> = {
  "scripted-clean": "Sample · Simulated brain · clean run",
  "scripted-flaky": "Sample · Simulated brain · flaky test",
  "scripted-malformed": "Sample · Simulated brain · malformed output",
  "webllm-qwen2.5-1.5b": "Sample · Qwen2.5 1.5B (WebLLM)",
};

export const sampleName = (path: string) => path.split("/").pop()!.replace(/\.otlp\.json$/, "");

export async function loadSamples(collector: Collector): Promise<string[]> {
  const ids: string[] = [];
  const entries = Object.entries(modules).sort(([a], [b]) => a.localeCompare(b));
  for (const [path, load] of entries) {
    const name = sampleName(path);
    try {
      const mod = await load();
      const result = collector.ingest(mod.default, { source: "sample", sourceId: `sample-${name}`, label: SAMPLE_LABELS[name] ?? `Sample · ${name}` });
      ids.push(...result.runIds);
    } catch (e) {
      console.error(`Sample ${name} failed to load:`, e);
    }
  }
  return ids;
}
