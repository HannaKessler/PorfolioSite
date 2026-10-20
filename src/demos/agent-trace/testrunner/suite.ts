import { createHarness, isTestFile, linkModules, summarize, type TestRunResult } from "./mini-expect";
import type { TestRequest } from "./protocol";

/**
 * Loads the project's test files as ES modules and runs them. Shared by the
 * browser test worker (Blob URLs) and the Node runner used in unit tests (data URLs).
 */
export async function runSuite(
  request: TestRequest,
  makeUrl: (code: string) => string,
  importModule: (url: string) => Promise<unknown>,
  scope: Record<string, unknown>,
): Promise<TestRunResult> {
  const harness = createHarness();
  const saved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(harness.globals)) {
    saved[k] = scope[k];
    scope[k] = v;
  }
  try {
    let urls: Record<string, string>;
    try {
      urls = linkModules(request.files, makeUrl);
    } catch (e) {
      return summarize([], e instanceof Error ? e.message : String(e));
    }
    for (const path of Object.keys(request.files).filter(isTestFile).sort()) {
      try {
        await importModule(urls[path]);
      } catch (e) {
        return summarize([], `${path}: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
      }
    }
    return await harness.run(request.options);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete scope[k];
      else scope[k] = v;
    }
  }
}
