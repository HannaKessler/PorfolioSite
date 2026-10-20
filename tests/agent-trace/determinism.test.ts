import { describe, expect, it } from "vitest";
import { baseRequest, runThroughPipeline } from "./helpers";
import type { NormSpan } from "../../src/demos/agent-trace/collector/normalize";

/** Canonical form: IDs replaced by tree position, times by offsets from the run start. */
export function canonical(spans: NormSpan[]) {
  const sorted = [...spans].sort((a, b) => (a.startNs < b.startNs ? -1 : a.startNs > b.startNs ? 1 : 0));
  const ids = new Map(sorted.map((s, i) => [s.spanId, i]));
  const t0 = sorted[0].startNs;
  return sorted.map((s) => ({
    i: ids.get(s.spanId),
    parent: s.parentSpanId ? ids.get(s.parentSpanId) : null,
    name: s.name,
    kind: s.kind,
    start: Number(s.startNs - t0),
    end: s.endNs === null ? null : Number(s.endNs - t0),
    status: s.status,
    attrs: s.attrs,
    events: s.events.map((e) => ({ name: e.name, t: Number(e.timeNs - t0), attrs: e.attrs })),
  }));
}

const structure = (spans: NormSpan[]) => canonical(spans).map(({ start, end, events, ...rest }) => ({ ...rest, events: events.map((e) => e.name) }));

describe("determinism", () => {
  it("10 seeded runs produce identical span trees, tool I/O and test results", async () => {
    const runs = [];
    for (let i = 0; i < 10; i++) {
      const c = await runThroughPipeline(baseRequest({ seed: 42, faults: { flakyTest: true, malformedOutput: true } }), { fake: false });
      runs.push(structure(c.store.index(c.runId)!.spans));
    }
    for (const r of runs.slice(1)) expect(r).toEqual(runs[0]);
  });

  it("golden trace: the scripted run matches the canonical OTLP snapshot", async () => {
    const c = await runThroughPipeline(baseRequest());
    expect(canonical(c.store.index(c.runId)!.spans)).toMatchSnapshot();
  });
});
