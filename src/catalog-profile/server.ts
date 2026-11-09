import { createSchema, createYoga } from "graphql-yoga";
import { parse } from "graphql";
import { GRAPHQL_URL, SLOW_FAULT_MS } from "./config";
import { typeDefs } from "./schema";
import type { ProfileStore } from "./store";
import { delay } from "./timeout";
import type { ProfileEvent } from "./types";

interface Context {
  store: ProfileStore;
}

const resolvers = {
  Query: {
    viewerProfile: (_: unknown, __: unknown, { store }: Context) => store.profile(),
    recommendedForYou: (_: unknown, args: { limit?: number }, { store }: Context) => store.recommended(args.limit ?? 12),
  },
  Mutation: {
    trackEvent: (_: unknown, args: { input: { type: string; productId?: string; query?: string } }, { store }: Context) => {
      if (args.input.type === "SEARCH") {
        // Searches join the existing history through syncSearchHistory, not a second log.
        return store.profile();
      }
      const productId = Number(args.input.productId);
      if (Number.isFinite(productId)) store.track(args.input.type as ProfileEvent["type"], productId);
      return store.profile();
    },
    syncSearchHistory: (_: unknown, args: { queries: string[] }, { store }: Context) => {
      store.syncSearches(args.queries);
      return store.profile();
    },
    setConsent: (_: unknown, args: { granted: boolean }, { store }: Context) => {
      store.setConsent(args.granted);
      return store.profile();
    },
    setDemoFaults: (
      _: unknown,
      args: { outage?: boolean; slow?: boolean; killSwitch?: boolean },
      { store }: Context,
    ) => {
      if (typeof args.outage === "boolean") store.faults.outage = args.outage;
      if (typeof args.slow === "boolean") store.faults.slow = args.slow;
      if (typeof args.killSwitch === "boolean") store.faults.killSwitch = args.killSwitch;
      return true;
    },
    recordExposure: (_: unknown, args: { productIds: string[]; requestId: string }, { store }: Context) => {
      store.recordExposure(args.productIds, args.requestId);
      return true;
    },
  },
  ViewerProfile: {
    __resolveReference: (ref: { id: string }, { store }: Context) => (ref.id === store.id ? store.profile() : null),
  },
};

function browserTypeDefs() {
  return typeDefs
    .replace(/extend schema @link\([^\n]+\)\n\n/, "")
    .replace(/ @key\(fields: "id"\)/, "");
}

export async function createProfileSchema() {
  const canUseSubgraph = typeof process !== "undefined" && Boolean(process.versions?.node);
  if (canUseSubgraph) {
    try {
      const { buildSubgraphSchema } = await import("@apollo/subgraph");
      return buildSubgraphSchema([{ typeDefs: parse(typeDefs), resolvers }]);
    } catch {
      // Fall through to Yoga's schema so the worker can still serve the API.
    }
  }
  return createSchema({ typeDefs: browserTypeDefs(), resolvers });
}

export async function createProfileYoga(store: ProfileStore) {
  const schema = await createProfileSchema();
  return createYoga({
    schema,
    graphqlEndpoint: GRAPHQL_URL,
    graphiql: false,
    landingPage: false,
    logging: false,
    context: () => ({ store }),
  });
}

export interface Backend {
  handle(request: Request): Promise<{ response: Response; requestId: string; serverMs: number }>;
}

export async function createBackend(store: ProfileStore): Promise<Backend> {
  const yoga = await createProfileYoga(store);
  return {
    async handle(request) {
      const requestId = store.nextRequestId();
      const started = performance.now();
      if (store.faults.outage) {
        const body = JSON.stringify({ errors: [{ message: "Injected outage", extensions: { code: "OUTAGE", injected: true } }] });
        const response = new Response(body, {
          status: 503,
          headers: { "content-type": "application/json", "x-request-id": requestId },
        });
        return { response, requestId, serverMs: performance.now() - started };
      }
      if (store.faults.killSwitch) {
        const body = JSON.stringify({
          errors: [{ message: "Personalization kill switch is on", extensions: { code: "KILL_SWITCH" } }],
        });
        const response = new Response(body, {
          status: 200,
          headers: { "content-type": "application/json", "x-request-id": requestId },
        });
        return { response, requestId, serverMs: performance.now() - started };
      }
      if (store.faults.slow) await delay(SLOW_FAULT_MS);
      const result = await yoga.fetch(request);
      const headers = new Headers(result.headers);
      headers.set("x-request-id", requestId);
      const serverMs = performance.now() - started;
      headers.set("server-timing", `app;dur=${serverMs.toFixed(1)}`);
      return { response: new Response(result.body, { status: result.status, headers }), requestId, serverMs };
    },
  };
}
