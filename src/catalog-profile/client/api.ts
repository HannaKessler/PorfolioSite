import { ApolloClient, HttpLink, InMemoryCache, gql } from "@apollo/client/core";
import { CLIENT_TIMEOUT_MS, GRAPHQL_URL } from "../config";
import { withBudget } from "../timeout";
import type { Connection } from "./connection";
import type { FallbackReason, FaultSettings, ProductRow, ViewerProfile } from "../types";

const RECOMMENDED = gql`
  query RecommendedForYou($limit: Int) {
    recommendedForYou(limit: $limit) {
      title
      source
      reason
      productIds
    }
    viewerProfile {
      id
      consent
      eventCount
      traits {
        priceMin
        priceMax
        recentSearches
        preferredCategories { name slug views searches carts }
      }
      segments { id label }
    }
  }
`;

const SYNC_SEARCHES = gql`
  mutation SyncSearchHistory($queries: [String!]!) {
    syncSearchHistory(queries: $queries) {
      id
      consent
      eventCount
      traits {
        priceMin
        priceMax
        recentSearches
        preferredCategories { name slug views searches carts }
      }
      segments { id label }
    }
  }
`;

const SET_CONSENT = gql`
  mutation SetConsent($granted: Boolean!) {
    setConsent(granted: $granted) {
      id
      consent
      eventCount
      traits { priceMin priceMax recentSearches preferredCategories { name slug views searches carts } }
      segments { id label }
    }
  }
`;

const TRACK = gql`
  mutation TrackEvent($input: TrackEventInput!) {
    trackEvent(input: $input) {
      id
      consent
      eventCount
      traits { priceMin priceMax recentSearches preferredCategories { name slug views searches carts } }
      segments { id label }
    }
  }
`;

const SET_FAULTS = gql`
  mutation SetDemoFaults($outage: Boolean, $slow: Boolean, $killSwitch: Boolean) {
    setDemoFaults(outage: $outage, slow: $slow, killSwitch: $killSwitch)
  }
`;

const RECORD_EXPOSURE = gql`
  mutation RecordExposure($productIds: [ID!]!, $requestId: ID!) {
    recordExposure(productIds: $productIds, requestId: $requestId)
  }
`;

export interface QuerySnapshot {
  request: string;
  response: string;
  elapsedMs: number;
  serverMs: number | null;
  fallback: FallbackReason;
  requestId: string | null;
  profile: ViewerProfile | null;
  row: ProductRow | null;
}

export class ProfileClient {
  private apollo: ApolloClient<unknown>;
  last: QuerySnapshot | null = null;
  faults: FaultSettings = { outage: false, slow: false, killSwitch: false };
  exposures: { at: number; productIds: string[]; requestId: string }[] = [];
  transportNote: string;

  constructor(connection: Connection) {
    this.transportNote = connection.fallbackReason
      ? `Direct worker (${connection.fallbackReason})`
      : "Service worker";
    const link = new HttpLink({
      uri: GRAPHQL_URL,
      fetch: async (uri, options) => connection.fetch(String(uri), options as RequestInit),
    });
    this.apollo = new ApolloClient({ link, cache: new InMemoryCache(), defaultOptions: { query: { fetchPolicy: "no-cache" }, mutate: { fetchPolicy: "no-cache" } } });
  }

  private describe(document: string, variables: unknown) {
    return JSON.stringify({ query: document.replace(/\s+/g, " ").trim(), variables }, null, 2);
  }

  async run<T>(label: string, work: (signal: AbortSignal) => Promise<T>, requestText: string): Promise<{ data: T | null; snapshot: QuerySnapshot }> {
    if (this.faults.killSwitch && label !== "faults" && label !== "consent") {
      const snapshot: QuerySnapshot = {
        request: requestText,
        response: JSON.stringify({ skipped: true, reason: "kill_switch" }, null, 2),
        elapsedMs: 0,
        serverMs: null,
        fallback: "kill_switch",
        requestId: null,
        profile: this.last?.profile ?? null,
        row: null,
      };
      this.last = snapshot;
      return { data: null, snapshot };
    }

    const timed = await withBudget(async (signal) => {
      const extra = { context: { fetchOptions: { signal } } };
      return work(signal);
    }, CLIENT_TIMEOUT_MS);

    const fallback: FallbackReason = timed.fallback ?? "ok";
    if (timed.fallback === "timeout") {
      const snapshot: QuerySnapshot = {
        request: requestText,
        response: JSON.stringify({ error: "Client timeout" }, null, 2),
        elapsedMs: timed.elapsedMs,
        serverMs: null,
        fallback: "timeout",
        requestId: null,
        profile: this.last?.profile ?? null,
        row: null,
      };
      this.last = snapshot;
      return { data: null, snapshot };
    }

    const payload = timed.value as { data?: T; errors?: { message: string; extensions?: { code?: string } }[] } | T;
    const body = JSON.stringify(payload, null, 2);
    const errors = payload && typeof payload === "object" && "errors" in (payload as object)
      ? ((payload as { errors?: { extensions?: { code?: string } }[] }).errors ?? [])
      : [];
    const code = errors[0]?.extensions?.code;
    const row =
      payload && typeof payload === "object" && payload !== null && "recommendedForYou" in (payload as object)
        ? ((payload as { recommendedForYou: ProductRow }).recommendedForYou)
        : payload && typeof payload === "object" && payload !== null && "data" in (payload as object)
          ? ((payload as { data?: { recommendedForYou?: ProductRow } }).data?.recommendedForYou ?? null)
          : null;

    let resolved: FallbackReason = "ok";
    if (code === "OUTAGE") resolved = "outage";
    else if (code === "KILL_SWITCH") resolved = "kill_switch";

    const snapshot: QuerySnapshot = {
      request: requestText,
      response: body,
      elapsedMs: timed.elapsedMs,
      serverMs: null,
      fallback: resolved,
      requestId: null,
      profile: null,
      row: row ?? null,
    };
    this.last = snapshot;
    return { data: timed.value as T, snapshot };
  }

  async recommendedForYou(limit = 12) {
    const requestText = this.describe("recommendedForYou", { limit });
    try {
      const result = await this.run(
        "recommended",
        () => this.apollo.query({ query: RECOMMENDED, variables: { limit } }).then((value) => value.data as { recommendedForYou: ProductRow; viewerProfile: ViewerProfile }),
        requestText,
      );
      if (result.data) {
        result.snapshot.profile = result.data.viewerProfile;
        result.snapshot.row = result.data.recommendedForYou;
        this.last = result.snapshot;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fallback: FallbackReason = /503|OUTAGE|Failed to fetch|Network/i.test(message) ? "outage" : "outage";
      const snapshot: QuerySnapshot = {
        request: requestText,
        response: JSON.stringify({ error: message }, null, 2),
        elapsedMs: this.last?.elapsedMs ?? 0,
        serverMs: null,
        fallback,
        requestId: null,
        profile: this.last?.profile ?? null,
        row: null,
      };
      if (this.last && this.last.fallback === "timeout") return { data: null, snapshot: this.last };
      this.last = snapshot;
      return { data: null, snapshot };
    }
  }

  async syncSearchHistory(queries: string[]) {
    const result = await this.apollo.mutate({ mutation: SYNC_SEARCHES, variables: { queries } });
    return result.data?.syncSearchHistory as ViewerProfile;
  }

  async setConsent(granted: boolean) {
    const result = await this.apollo.mutate({ mutation: SET_CONSENT, variables: { granted } });
    if (!granted) this.exposures = [];
    return result.data?.setConsent as ViewerProfile;
  }

  async trackEvent(type: "PRODUCT_VIEW" | "ADD_TO_CART", productId: number) {
    const result = await this.apollo.mutate({ mutation: TRACK, variables: { input: { type, productId: String(productId) } } });
    return result.data?.trackEvent as ViewerProfile;
  }

  async setFaults(faults: Partial<FaultSettings>) {
    this.faults = { ...this.faults, ...faults };
    await this.apollo.mutate({ mutation: SET_FAULTS, variables: this.faults });
  }

  async recordExposure(productIds: string[], requestId: string) {
    this.exposures.push({ at: Date.now(), productIds, requestId });
    await this.apollo.mutate({ mutation: RECORD_EXPOSURE, variables: { productIds, requestId } });
  }
}
