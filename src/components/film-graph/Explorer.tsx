import { Suspense, lazy, useCallback, useId, useMemo, useRef, useState } from "react";
import { connect, type Connection } from "../../filmgraph/client/connection";
import { createApi, type Api, type LogEntry } from "../../filmgraph/client/api";
import {
  PRESETS,
  SIX_DEGREES_PRESET,
  defaultChoices,
  variablesFor,
  type BlankKind,
  type Choice,
  type Preset,
} from "../../filmgraph/client/presets";
import { graphqlSearch, suggestionsFromGraphQL } from "../../filmgraph/client/search";
import { formatMs } from "../../filmgraph/client/metrics";
import { runGraphQL, runRest, type GraphQLRun, type RestRun } from "../../filmgraph/client/runner";
import type { RunMetrics } from "../../filmgraph/client/metrics";
import type { BootStatus } from "../../filmgraph/protocol";
import { Answer, type AnswerState } from "./Answer";
import { BootBanner, EngineNote } from "./BootBanner";
import { QuestionBuilder } from "./QuestionBuilder";
import type { SearchOutcome } from "./NameCombobox";
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

/** The question as plain text with the chosen names, e.g. for the request log. */
const questionText = (preset: Preset, choices: Record<string, Choice>) =>
  preset.sentence.map((part) => (typeof part === "string" ? part : (choices[part.variable] ?? part.default).name)).join("");

const sameVariables = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

interface LastRun {
  /** Counts runs, so tests and assistive tech can tell a fresh result from an old one. */
  count: number;
  signature: string;
  presetId: string;
  custom: boolean;
  question: string;
}

export default function Explorer() {
  const [status, setStatus] = useState<BootStatus | null>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const apiRef = useRef<Api | null>(null);
  const runCounter = useRef(0);
  const currentRun = useRef<LoggedRun | null>(null);
  const [runs, setRuns] = useState<LoggedRun[]>([]);

  const [preset, setPreset] = useState<Preset>(PRESETS[0]);
  const [choicesBy, setChoicesBy] = useState<Record<string, Record<string, Choice>>>({});
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
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState("");
  const [started, setStarted] = useState(false);
  const bootRef = useRef<Promise<Api> | null>(null);
  const editorLabel = useId();
  const variablesId = useId();

  const choices = choicesBy[preset.id] ?? defaultChoices(preset);
  const isCustom = query.trim() !== preset.query.trim();
  const variables = useMemo(() => parseVariables(variablesText), [variablesText]);
  const variablesError = typeof variables === "string" ? variables : null;
  const ready = status?.phase === "ready" && !!connection;
  const booting = started && !ready && status?.phase !== "error";
  const handEdited = typeof variables !== "string" && !sameVariables(variables, variablesFor(preset, choices));
  const signature = JSON.stringify([preset.id, query.trim(), variablesText.replace(/\s+/g, "")]);
  const stale = !!lastRun && lastRun.signature !== signature;

  /**
   * Starts the in-browser backend the first time it is needed (Run, or typing
   * in a name blank). Nothing is downloaded or booted on page load.
   */
  const ensureBackend = useCallback((): Promise<Api> => {
    if (!bootRef.current) {
      setStarted(true);
      setStatus({ phase: "engine", detail: "Starting the backend worker", elapsedMs: 0 });
      bootRef.current = connect(setStatus).then((conn) => {
        const api = createApi(conn, (entry) => {
          const run = currentRun.current;
          if (!run) return;
          run.entries.push(entry);
          setRuns((list) => list.map((item) => (item.id === run.id ? { ...run, entries: [...run.entries] } : item)));
        });
        apiRef.current = api;
        setConnection(conn);
        return api;
      });
      bootRef.current.catch((error: Error) => setStatus({ phase: "error", detail: error.message, elapsedMs: 0 }));
    }
    return bootRef.current;
  }, []);

  /** Groups the requests made by one button press in the request log. */
  const withRun = useCallback(
    async <T,>(label: string, fn: (api: Api) => Promise<T>): Promise<T | null> => {
      const api = await ensureBackend();
      const run: LoggedRun = { id: ++runCounter.current, label, startedAt: performance.now(), entries: [] };
      currentRun.current = run;
      setRuns((list) => [run, ...list].slice(0, 12));
      try {
        return await fn(api);
      } finally {
        currentRun.current = null;
      }
    },
    [ensureBackend],
  );

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

  /** The only way queries run: the Run button, Ctrl+Enter, or the GraphQL/REST-only buttons. */
  const run = async (which: "graphql" | "rest" | "both") => {
    const vars = parseVariables(variablesText);
    if (typeof vars === "string" || running) return;
    const target = preset;
    const text = query;
    const customQuery = text.trim() !== target.query.trim();
    const question = questionText(target, choices);
    setRunning(which);
    setRunError(null);
    setRunStatus("");
    const startedAt = performance.now();
    try {
      let graphqlRequests = 0;
      let restRequests = 0;
      await withRun(`${customQuery ? "Edited query" : question} · ${which === "both" ? "GraphQL + REST" : which === "graphql" ? "GraphQL" : "REST"}`, async (api) => {
        if (which !== "rest") {
          const result = await doGraphQL(api, vars, text);
          graphqlRequests = result.metrics.requests;
        } else setGqlRun(null);
        if (which !== "graphql" && !customQuery) {
          const result = await doRest(api, vars, target);
          restRequests = result.metrics.requests;
        } else setRestRun(null);
      });
      setLastRun((previous) => ({ count: (previous?.count ?? 0) + 1, signature, presetId: target.id, custom: customQuery, question }));
      setResultTab(which === "rest" ? "rest" : "graphql");
      const parts = [graphqlRequests && `GraphQL ${graphqlRequests} request`, restRequests && `REST ${restRequests} requests`].filter(Boolean);
      setRunStatus(`Done in ${formatMs(performance.now() - startedAt)}${parts.length ? `: ${parts.join(", ")}` : ""}.`);
    } catch (error) {
      setRunError((error as Error).message);
    } finally {
      setRunning(null);
    }
  };

  // Picking a question or a name only changes the request; Run executes it.
  const choosePreset = (next: Preset) => {
    if (next.id === preset.id) return;
    const nextChoices = choicesBy[next.id] ?? defaultChoices(next);
    setPreset(next);
    setQuery(next.query);
    setVariablesText(prettyVariables(variablesFor(next, nextChoices)));
  };

  const chooseName = (variable: string, choice: Choice) => {
    const nextChoices = { ...choices, [variable]: choice };
    setChoicesBy((all) => ({ ...all, [preset.id]: nextChoices }));
    setVariablesText(prettyVariables(variablesFor(preset, nextChoices)));
  };

  const search = useCallback(
    async (kind: BlankKind, text: string): Promise<SearchOutcome> => {
      const api = await ensureBackend();
      const { query: searchQuery, variables: searchVariables } = graphqlSearch(kind, text);
      // Always sent as a persisted query hash, so it keeps working in allowlist mode.
      const result = await api.graphql(searchQuery, searchVariables, {
        batching: true,
        persisted: true,
        persistedOnly: options.persistedOnly,
      });
      if (!result.body?.data && result.body?.errors?.length) throw new Error(result.body.errors[0].message);
      return {
        suggestions: suggestionsFromGraphQL(kind, result.body?.data),
        via: `POST /graphql (persisted hash) · ${result.entry.dbQueries} SQL · ${formatMs(result.entry.ms)}`,
      };
    },
    [ensureBackend, options.persistedOnly],
  );

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
  const failed = status?.phase === "error";
  const busy = !!running || failed;
  const graphqlMetrics: RunMetrics | null = gqlRun?.metrics ?? null;

  let answer: AnswerState;
  if (running && running !== "n1" && !ready) answer = { kind: "booting", detail: status?.detail ? `${status.detail}.` : "" };
  else if (running && running !== "n1") answer = { kind: "running" };
  else if (runError) answer = { kind: "error", message: runError };
  else if (!lastRun) answer = { kind: "idle" };
  else if (lastRun.custom) answer = { kind: "custom" };
  else {
    const body = gqlRun?.result.body;
    const data = body?.data ?? restRun?.data;
    if (data) answer = { kind: "done", presetId: lastRun.presetId, data };
    else if (restRun?.error) answer = { kind: "error", message: restRun.error };
    else answer = { kind: "error", message: body?.errors?.[0]?.message ?? "The request returned no data." };
  }

  return (
    <div className="fg-app">
      <BootBanner status={status} connection={connection} started={started} onReset={resetDatabase} />

      <QuestionBuilder
        presets={PRESETS}
        preset={preset}
        choices={choices}
        onPreset={choosePreset}
        onChoice={chooseName}
        onRun={() => void run("both")}
        search={search}
        onFirstInput={() => void ensureBackend()}
        booting={booting}
        running={running === "both"}
        disabled={busy || !!variablesError}
        status={runStatus}
      />

      <Answer
        state={answer}
        stale={stale && answer.kind !== "running" && answer.kind !== "booting"}
        question={lastRun?.question ?? null}
        runCount={lastRun?.count ?? 0}
      />

      <div className="fg-section-head fg-raw-head">
        <h2>Under the hood</h2>
        <p>The generated GraphQL query and REST calls for your question, their raw responses, and how they compare.</p>
        {stale && answer.kind === "done" && <p className="fg-ans-stale fg-stale-inline">These results are from your previous question.</p>}
      </div>
      <EngineNote status={status} connection={connection} onReset={resetDatabase} />

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
                  Generated from your question. Edit freely: autocomplete knows the schema. <kbd>Ctrl</kbd>+<kbd>Enter</kbd>{" "}
                  runs it, <kbd>Esc</kbd> then <kbd>Tab</kbd> leaves the editor.
                </p>
                <Suspense fallback={<textarea className="fg-textarea fg-editor-fallback" value={query} onChange={(e) => setQuery(e.target.value)} aria-labelledby={editorLabel} rows={16} />}>
                  <QueryEditor value={query} onChange={setQuery} onRun={() => void run("both")} labelId={editorLabel} />
                </Suspense>
                <label className="fg-label" htmlFor={variablesId}>
                  Variables <span className="fg-hint-inline">(the IDs of the names you picked)</span>
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
                {handEdited && !variablesError && (
                  <p className="fg-note">You edited the variables, so they may not match the names in the question.</p>
                )}
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
                  <p className="fg-note">You edited the query, so there is no matching REST plan. Pick a question to compare.</p>
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
                <p className="fg-placeholder">{running ? "Running…" : "Press Run to see the response."}</p>
              )
            ) : restRun ? (
              restRun.error ? (
                <p className="fg-error-text" role="alert">{restRun.error}</p>
              ) : (
                <JsonView value={restRun.data} label="Data assembled from the REST responses" />
              )
            ) : (
              <p className="fg-placeholder">
                {isCustom ? "Edited queries have no REST plan." : running ? "Running…" : "Press Run to see the assembled result."}
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
