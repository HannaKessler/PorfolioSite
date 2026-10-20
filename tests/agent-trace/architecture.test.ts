import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Architecture rule: the monitor (tracing, collector, store, viewer) never imports
// a brain, so it cannot behave differently for the scripted and real models.
const root = fileURLToPath(new URL("../../src/demos/agent-trace/", import.meta.url));
const MONITOR = ["tracing", "collector", "store", "viewer"];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

describe("architecture", () => {
  it("monitor modules do not import from brains/", () => {
    const offenders: string[] = [];
    for (const dir of MONITOR) {
      for (const file of files(join(root, dir))) {
        const src = readFileSync(file, "utf8");
        for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
          if (/(^|\/)brains(\/|$)/.test(m[1])) offenders.push(`${relative(root, file)} → ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("only agent/runner.ts constructs a brain", () => {
    const constructing = files(root)
      .filter((f) => !f.includes(`${join("brains", "")}`))
      .filter((f) => /new (ScriptedBrain|WebLLMBrain)\b|WebLLMBrain\.create\(/.test(readFileSync(f, "utf8")));
    expect(constructing.map((f) => relative(root, f))).toEqual([join("agent", "runner.ts")]);
  });
});
