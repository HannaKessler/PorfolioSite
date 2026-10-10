import { Suspense, lazy, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { connect, type Connection } from "../../filmgraph/client/connection";
import { createApi, type Api, type LogEntry } from "../../filmgraph/client/api";
import { PRESETS, SIX_DEGREES_PRESET, type Preset } from "../../filmgraph/client/presets";
import { runGraphQL, runRest, type GraphQLRun, type RestRun } from "../../filmgraph/client/runner";
import type { RunMetrics } from "../../filmgraph/client/metrics";
import type { BootStatus } from "../../filmgraph/protocol";
import { BootBanner } from "./BootBanner";
import { ComparisonStrip } from "./ComparisonStrip";
import { NPlusOne, type NPlusOneResult } from "./NPlusOne";
import { PersistedPanel, type PersistedStats } from "./PersistedPanel";
import { RequestLog, type LoggedRun } from "./RequestLog";
import { JsonView } from "./JsonView";
import { Switch } from "./Switch";
import { Tabs } from "./Tabs";

const QueryEditor = lazy(() => import("./QueryEditor"));

export interface Options {
  batching: boolean;
  persisted: boolean;
  persistedOnly: boolean;
  etags: boolean;
}

const prettyVariables = (variables: Record<string, string>) => JSON.stringify(variables, null, 2);

function parseVariables(text: string): Record<string, string> | string {
  if (!text.trim()) return {};
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return "Variables must be a JSON object.";
    return value;
  } catch (error) {
    return `Variables are not valid JSON: ${(error as Error).message}`;
  }
}

export default function Explorer() {
  const [status, setStatus] = useState<BootStatus | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const apiRef = useRef<Api | null>(null);
  const runCounter = useRef(0);
  const currentRun = useRef<LoggedRun | null>(null);
  const [runs, setRuns] = useState<LoggedRun[]>([]);

  const [preset, setPreset] = useState<Preset>(PRESETS[0]);
  const [query, setQuery] = useState(PRESETS[0].query);
  const [variablesText, setVariablesText] = useState(prettyVariables(PRESETS[0].variables));
  const [options, setOptions] = useState<Options>({ batching: true, persisted: false, persistedOnly: false, etags: true });
  const [requestTab, setRequestTab] = useState<"graphql" | "rest">("graphql");
  const [resultTab, setResultTab] = useState<"graphql" | "rest">("graphql");
  const [gqlRun, setGqlRun] = useState<GraphQLRun | null>(null);
  const [restRun, setRestRun] = useState<RestRun | null>(null);
  const [running, setRunning] = useState<null | "graphql" | "rest" | "both" | "n1">(null);
  const [n1, setN1] = useState<NPlusOneResult | null>(null);
  const [persistedStats, setPersistedStats] = useState<PersistedStats | null>(null);
  const autoRan = useRef(false);
  const editorLabel = useId();
  const variablesId = useId();

  const isCustom = query.trim() !== preset.query.trim();
  const variables = useMemo(() => parseVariables(variablesText), [variablesText]);
  const variablesError = typeof variables === "string" ? variables : null;
  const ready = status?.phase === "ready" && !!connection;

  useEffect(() => {
    let cancelled = false;
    connect((next) => !cancelled && setStatus(next))
      .then((conn) => {
        if (cancelled) return;
        apiRef.current = createApi(conn, (entry) => {
          const run = currentRun.current;
          if (!run) return;
          run.entries.push(entry);
          setRuns((list) => list.map((item) => (item.id === run.id ? { ...run, entries: [...run.entries] } : item)));
        });
        setConnection(conn);
      })
      .catch((error: Error) => !cancelled && setStatus({ phase: "error", detail: error.message, elapsedMs: 0 }));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Groups the requests made by one button press in the request log. */
  const withRun = useCallback(async <T,>(label: string, fn: (api: Api) => Promise<T>): Promise<T | null> => {
    const api = apiRef.current;
    if (!api) return null;
    const run: LoggedRun = { id: ++runCounter.current, label, startedAt: performance.now(), entries: [] };
    currentRun.current = run;
    setRuns((list) => [run, ...list].slice(0, 12));
    try {
      return await fn(api);
    } finally {
      currentRun.current = null;
    }
  }, []);

  const doGraphQL = useCallback(
    async (api: Api, vars: Record<string, string>, text: string) => {
      const run = await runGraphQL(api, text, vars, options);
      setGqlRun(run);
      setPersistedStats({
        sentBytes: run.result.entry.requestBytes,
        fullBytes: run.result.fullQueryBytes,
        persisted: options.persisted,
        persistedOnly: options.persistedOnly,
        error: run.result.body?.errors?.[0]?.message ?? null,
      });
      return run;
    },
    [options],
  );

  const doRest = useCallback(
    async (api: Api, vars: Record<string, string>, target: Preset) => {
      const run = await runRest(api, target, vars, options.etags);
      setRestRun(run);
      return run;
    },
    [options.etags],
  );

  const run = useCallback(
    async (which: "graphql" | "rest" | "both", target: Preset = preset, text: string = query, varsText = variablesText) => {
      const vars = parseVariables(varsText);
      if (typeof vars === "string" || running) return;
      setRunning(which);
      const customQuery = text.trim() !== target.query.trim();
      try {
        await withRun(`${target.label}${customQuery ? " (edited)" : ""} · ${which === "both" ? "GraphQL + REST" : which === "graphql" ? "GraphQL" : "REST"}`, async (api) => {
          if (which !== "rest") await doGraphQL(api, vars, text);
          if (which !== "graphql") {
            if (customQuery) setRestRun(null);
            else await doRest(api, vars, target);
          }
        });
        if (which === "rest") setResultTab("rest");
        if (which === "graphql") setResultTab("graphql");
      } finally {
        setRunning(null);
      }
    },
    [preset, query, variablesText, running, withRun, doGraphQL, doRest],
  );

  const choosePreset = (next: Preset) => {
    setPreset(next);
    setQuery(next.query);
    const text = prettyVariables(next.variables);
    setVariablesText(text);
    setGqlRun(null);
    setRestRun(null);
    void run("both", next, next.query, text);
  };

  // Run the first preset once the backend is ready, so the page opens with results.
  useEffect(() => {
    if (ready && !autoRan.current) {
      autoRan.current = true;
      void run("both");
    }
  }, [ready, run]);

  const runNPlusOne = async () => {
    if (running) return;
    setRunning("n1");
    try {
      await withRun("Six degrees · batching off, then on", async (api) => {
        const vars = SIX_DEGREES_PRESET.variables;
        const base = { persisted: false, persistedOnly: false };
        const off = await runGraphQL(api, SIX_DEGREES_PRESET.query, vars, { ...base, batching: false });
        const on = await runGraphQL(api, SIX_DEGREES_PRESET.query, vars, { ...base, batching: true });
        const rest = await runRest(api, SIX_DEGREES_PRESET, vars, false);
        const castSize = (on.result.body?.data as { film?: { cast?: unknown[] } } | undefined)?.film?.cast?.length ?? 0;
        setN1({ off: off.metrics, on: on.metrics, rest: rest.metrics, castSize, sqlOn: on.result.entry.sql.map((e) => e.sql) });
      });
    } finally {
      setRunning(null);
    }
  };

  const probeUnknown = async () => {
    if (running) return;
    setRunning("graphql");
    try {
      await withRun("Persisted-only · unknown query", async (api) => {
        const text = "query NotOnTheList { genres { name filmCount } }";
        const result = await api.graphql(text, {}, { batching: true, persisted: false, persistedOnly: true });
        setPersistedStats({
          sentBytes: result.entry.requestBytes,
          fullBytes: result.fullQueryBytes,
          persisted: false,
          persistedOnly: true,
          error: result.body?.errors?.[0]?.message ?? null,
          probe: true,
        });
      });
    } finally {
      setRunning(null);
    }
  };

  const resetDatabase = async () => {
    if (!connection) return;
    setStatus({ phase: "engine", detail: "Deleting your local copy", elapsedMs: 0 });
    await connection.reset();
    location.reload();
  };

  const setOption = (key: keyof Options) => (value: boolean) => setOptions((current) => ({ ...current, [key]: value }));
  const restSteps = preset.restSteps(typeof variables === "string" ? preset.variables : variables);
  const busy = !!running || !ready;
  const graphqlMetrics: RunMetrics | null = gqlRun?.metrics ?? null;

  return (
    <div className="fg-app">
      <BootBanner status={status} connection={connection} onReset={resetDatabase} />

      <section className="fg-section" aria-labelledby="fg-presets-title">
        <div className="fg-section-head">
          <h2 id="fg-presets-title">Pick a question</h2>
          <p>Each one runs as a single GraphQL query and as the REST calls needed for the same data.</p>
        </div>
        <div className="fg-presets" role="group" aria-label="Preset queries">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="fg-chip"
              aria-pressed={item.id === preset.id}
              onClick={() => choosePreset(item)}
              disabled={busy}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="fg-summary">{preset.summary}</p>
      </section>

      <div className="fg-workbench">
        <section className="fg-panel" aria-labelledby="fg-request-title">
          <div className="fg-panel-head">
            <h3 id="fg-request-title" className="visually-hidden">Request</h3>
            <Tabs
              label="Request"
              value={requestTab}
              onChange={setRequestTab}
              tabs={[
                { id: "graphql", label: "GraphQL query" },
                { id: "rest", label: "REST calls" },
              ]}
              idPrefix="fg-req"
            />
          </div>
          <div
            id={`fg-req-panel-${requestTab}`}
            role="tabpanel"
            aria-labelledby={`fg-req-tab-${requestTab}`}
            className="fg-panel-body"
          >
            {requestTab === "graphql" ? (
              <>
                <p id={editorLabel} className="fg-hint">
                  Edit freely. Autocomplete knows the schema. <kbd>Ctrl</kbd>+<kbd>Enter</kbd> runs it,{" "}
                  <kbd>Esc</kbd> then <kbd>Tab</kbd> leaves the editor.
                </p>
                <Suspense fallback={<textarea className="fg-textarea fg-editor-fallback" value={query} onChange={(e) => setQuery(e.target.value)} aria-labelledby={editorLabel} rows={16} />}>
                  <QueryEditor value={query} onChange={setQuery} onRun={() => void run("graphql")} labelId={editorLabel} />
                </Suspense>
                <label className="fg-label" htmlFor={variablesId}>
                  Variables <span className="fg-hint-inline">(IDs are Wikidata IDs)</span>
                </label>
                <textarea
                  id={variablesId}
                  className="fg-textarea fg-variables"
                  value={variablesText}
                  onChange={(event) => setVariablesText(event.target.value)}
                  rows={3}
                  spellCheck={false}
                  aria-invalid={!!variablesError}
                  aria-describedby={variablesError ? `${variablesId}-error` : undefined}
                />
                {variablesError && (
                  <p id={`${variablesId}-error`} className="fg-error-text">
                    {variablesError}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="fg-hint">
                  The same data from the REST API. Calls in one step run in parallel, and each step waits for the one
                  before it.
                </p>
                {isCustom ? (
                  <p className="fg-note">You edited the query, so there is no matching REST plan. Choose a preset to compare.</p>
                ) : (
                  <ol className="fg-steps">
                    {restSteps.map((step) => (
                      <li key={step}>
                        <code>{step}</code>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            )}
          </div>
          <fieldset className="fg-options">
            <legend>Server options</legend>
            <Switch checked={options.batching} onChange={setOption("batching")} label="DataLoader batching" hint="Off shows the N+1 problem" />
            <Switch checked={options.persisted} onChange={setOption("persisted")} label="Send persisted query hash" hint="GraphQL only" />
            <Switch checked={options.persistedOnly} onChange={setOption("persistedOnly")} label="Reject non-persisted queries" hint="Allowlist mode" />
            <Switch checked={options.etags} onChange={setOption("etags")} label="ETag revalidation" hint="REST only" />
          </fieldset>
          <div className="fg-actions">
            <button type="button" className="button button-primary" onClick={() => void run("both")} disabled={busy || !!variablesError}>
              {running === "both" ? "Running…" : "Run both"}
            </button>
            <button type="button" className="button button-ghost" onClick={() => void run("graphql")} disabled={busy || !!variablesError}>
              GraphQL only
            </button>
            <button type="button" className="button button-ghost" onClick={() => void run("rest")} disabled={busy || isCustom || !!variablesError}>
              REST only
            </button>
          </div>
        </section>

        <section className="fg-panel" aria-labelledby="fg-result-title">
          <div className="fg-panel-head">
            <h3 id="fg-result-title" className="visually-hidden">Result</h3>
            <Tabs
              label="Result"
              value={resultTab}
              onChange={setResultTab}
              tabs={[
                { id: "graphql", label: "GraphQL result" },
                { id: "rest", label: "REST result" },
              ]}
              idPrefix="fg-res"
            />
          </div>
          <div
            id={`fg-res-panel-${resultTab}`}
            role="tabpanel"
            aria-labelledby={`fg-res-tab-${resultTab}`}
            className="fg-panel-body"
            aria-busy={!!running}
          >
            {resultTab === "graphql" ? (
              gqlRun ? (
                <JsonView value={gqlRun.result.body} label="GraphQL response body" />
              ) : (
                <p className="fg-placeholder">{ready ? "Run a query to see the response." : "Waiting for the database…"}</p>
              )
            ) : restRun ? (
              restRun.error ? (
                <p className="fg-error-text" role="alert">{restRun.error}</p>
              ) : (
                <JsonView value={restRun.data} label="Data assembled from the REST responses" />
              )
            ) : (
              <p className="fg-placeholder">
                {isCustom ? "Edited queries have no REST plan." : ready ? "Run REST to see the assembled result." : "Waiting for the database…"}
              </p>
            )}
          </div>
        </section>
      </div>

      <ComparisonStrip graphql={graphqlMetrics} rest={restRun?.metrics ?? null} restError={restRun?.error ?? null} running={running === "both"} />

      <div className="fg-demos">
        <NPlusOne result={n1} onRun={() => void runNPlusOne()} disabled={busy} running={running === "n1"} />
        <PersistedPanel stats={persistedStats} onProbe={() => void probeUnknown()} disabled={busy} />
      </div>

      <RequestLog runs={runs} />
    </div>
  );
}
