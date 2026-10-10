/** Runs a GraphQL query or a REST plan through the API client and measures it. */
import type { Api, GraphQLOptions, GraphQLResult, LogEntry } from "./api";
import type { Preset } from "./presets";
import { summarize, type RunMetrics } from "./metrics";

export interface GraphQLRun {
  result: GraphQLResult;
  metrics: RunMetrics;
}

export interface RestRun {
  data?: unknown;
  error?: string;
  metrics: RunMetrics;
  entries: LogEntry[];
}

export async function runGraphQL(
  api: Api,
  query: string,
  variables: Record<string, unknown>,
  options: GraphQLOptions,
): Promise<GraphQLRun> {
  const start = performance.now();
  const result = await api.graphql(query, variables, options);
  const ms = performance.now() - start;
  return { result, metrics: summarize("GraphQL", [result.entry], [result.body], result.body?.data, ms) };
}

export async function runRest(
  api: Api,
  preset: Preset,
  variables: Record<string, string>,
  useEtags: boolean,
): Promise<RestRun> {
  const entries: LogEntry[] = [];
  const payloads: unknown[] = [];
  const start = performance.now();
  const get = async (path: string) => {
    const response = await api.rest(path, useEtags);
    entries.push(response.entry);
    payloads.push(response.body);
    if (response.status >= 400) {
      const error = (response.body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new Error(`${path} returned ${response.status}${error ? `: ${error.message}` : ""}`);
    }
    return response.body;
  };
  try {
    const data = await preset.rest(get, variables);
    return { data, entries, metrics: summarize("REST", entries, payloads, data, performance.now() - start) };
  } catch (error) {
    return {
      error: (error as Error).message,
      entries,
      metrics: summarize("REST", entries, payloads, undefined, performance.now() - start),
    };
  }
}
