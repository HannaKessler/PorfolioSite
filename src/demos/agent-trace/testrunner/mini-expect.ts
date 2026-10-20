/**
 * A tiny describe/it/expect harness (about 1 KB minified) that runs the virtual
 * project's tests inside the test worker. Only what the task's tests need.
 */

export interface TestCaseResult {
  name: string;
  passed: boolean;
  message?: string;
}

export interface TestRunResult {
  passed: number;
  failed: number;
  failures: { name: string; message: string }[];
  tests: TestCaseResult[];
  /** Set when the suite could not be loaded at all (syntax error, missing module). */
  error?: string;
}

export interface RunOptions {
  /** Fault injection: the test at floor(pick × count) is made to fail. A number in [0, 1). */
  forceFailPick?: number;
}

type Fn = () => unknown;

const fmt = (v: unknown): string => {
  if (typeof v === "string") return JSON.stringify(v);
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => deepEqual((a as never)[k], (b as never)[k]));
};

class AssertionError extends Error {}

interface Matchers {
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toBeTruthy(): void;
  toContain(item: unknown): void;
  toThrow(expected?: (new (...a: never[]) => Error) | string | RegExp): void;
  not?: Matchers;
}

function makeExpect(actual: unknown, negate = false): Matchers {
  const check = (ok: boolean, msg: string) => {
    if (ok === negate) throw new AssertionError(negate ? `not: ${msg}` : msg);
  };
  const api: Matchers = {
    toBe: (expected: unknown) => check(Object.is(actual, expected), `expected ${fmt(actual)} to be ${fmt(expected)}`),
    toEqual: (expected: unknown) => check(deepEqual(actual, expected), `expected ${fmt(actual)} to equal ${fmt(expected)}`),
    toBeTruthy: () => check(Boolean(actual), `expected ${fmt(actual)} to be truthy`),
    toContain: (item: unknown) =>
      check((actual as { includes?: (x: unknown) => boolean })?.includes?.(item) ?? false, `expected ${fmt(actual)} to contain ${fmt(item)}`),
    toThrow: (expected?: (new (...a: never[]) => Error) | string | RegExp) => {
      let thrown: unknown;
      let didThrow = false;
      try {
        (actual as Fn)();
      } catch (e) {
        didThrow = true;
        thrown = e;
      }
      const message = thrown instanceof Error ? thrown.message : String(thrown);
      let ok = didThrow;
      if (ok && typeof expected === "function") ok = thrown instanceof expected;
      else if (ok && typeof expected === "string") ok = message.includes(expected);
      else if (ok && expected instanceof RegExp) ok = expected.test(message);
      const what = typeof expected === "function" ? expected.name : expected ? String(expected) : "an error";
      check(ok, didThrow ? `expected function to throw ${what}, but it threw ${fmt(message)}` : `expected function to throw ${what}`);
    },
  };
  return negate ? api : { ...api, not: makeExpect(actual, true) };
}

/** Collects describe/it registrations from test modules, then runs them in order. */
export function createHarness() {
  const tests: { name: string; fn: Fn }[] = [];
  const prefix: string[] = [];
  const globals = {
    describe(name: string, fn: Fn) {
      prefix.push(name);
      try {
        fn();
      } finally {
        prefix.pop();
      }
    },
    it(name: string, fn: Fn) {
      tests.push({ name: [...prefix, name].join(" > "), fn });
    },
    expect: (actual: unknown) => makeExpect(actual),
  };

  async function run(options: RunOptions = {}): Promise<TestRunResult> {
    const results: TestCaseResult[] = [];
    const forced = options.forceFailPick === undefined ? -1 : Math.floor(options.forceFailPick * tests.length);
    for (const [i, t] of tests.entries()) {
      try {
        if (i === forced) throw new Error("Injected flaky failure (fault injection)");
        await t.fn();
        results.push({ name: t.name, passed: true });
      } catch (e) {
        results.push({ name: t.name, passed: false, message: e instanceof Error ? e.message : String(e) });
      }
    }
    return summarize(results);
  }

  return { globals, run, names: () => tests.map((t) => t.name) };
}

export function summarize(tests: TestCaseResult[], error?: string): TestRunResult {
  const failures = tests.filter((t) => !t.passed).map((t) => ({ name: t.name, message: t.message ?? "failed" }));
  return { passed: tests.length - failures.length, failed: failures.length, failures, tests, ...(error ? { error } : {}) };
}

/**
 * Rewrites relative import specifiers so modules can be loaded from object URLs.
 * Returns a URL for every file; `makeUrl` creates a Blob URL in the browser.
 */
export function linkModules(files: Record<string, string>, makeUrl: (code: string) => string): Record<string, string> {
  const urls: Record<string, string> = {};
  const visiting = new Set<string>();
  const resolve = (from: string, spec: string): string => {
    const base = from.split("/").slice(0, -1);
    for (const part of spec.split("/")) {
      if (part === "..") base.pop();
      else if (part !== ".") base.push(part);
    }
    return base.join("/");
  };
  const link = (path: string): string => {
    if (urls[path]) return urls[path];
    if (visiting.has(path)) throw new Error(`Circular import involving ${path}`);
    const source = files[path];
    if (source === undefined) throw new Error(`Cannot find module '${path}'`);
    visiting.add(path);
    const code = source.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(["'])(\.{1,2}\/[^"']+)\2/g, (_m, lead, q, spec) => {
      return `${lead}${q}${link(resolve(path, spec))}${q}`;
    });
    visiting.delete(path);
    urls[path] = makeUrl(code);
    return urls[path];
  };
  for (const path of Object.keys(files)) if (path.endsWith(".js")) link(path);
  return urls;
}

export const isTestFile = (path: string) => /\.test\.js$/.test(path);
