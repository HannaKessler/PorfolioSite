import { describe, expect, it } from "vitest";
import { catalog } from "../../src/scripts/catalog-data";
import { ProfileStore } from "../../src/catalog-profile/store";
import { deriveTraits } from "../../src/catalog-profile/traits";
import { createBackend } from "../../src/catalog-profile/server";
import { CLIENT_TIMEOUT_MS, GRAPHQL_URL, SLOW_FAULT_MS } from "../../src/catalog-profile/config";
import { delay, withBudget } from "../../src/catalog-profile/timeout";

function firstProduct() {
  const product = catalog.products[0];
  if (!product) throw new Error("catalog is empty");
  return product;
}

function otherCategoryProduct(slug: string) {
  const product = catalog.products.find((item) => item.category !== slug);
  if (!product) throw new Error("expected another category");
  return product;
}

describe("search history feeds traits", () => {
  it("uses the synced search list rather than a second log", () => {
    const store = new ProfileStore();
    store.setConsent(true);
    const queries = ["lipstick", "phone"];
    store.syncSearches(queries);
    const traits = store.profile().traits;
    expect(traits.recentSearches).toEqual(queries);
    expect(deriveTraits(queries, []).recentSearches).toEqual(queries);
    expect(store.events.filter((event) => (event as { type: string }).type === "SEARCH")).toEqual([]);
  });

  it("replaces the search list when the shop history changes", () => {
    const store = new ProfileStore();
    store.setConsent(true);
    store.syncSearches(["lipstick", "phone"]);
    store.syncSearches(["phone"]);
    expect(store.profile().traits.recentSearches).toEqual(["phone"]);
  });
});

describe("views and carts", () => {
  it("records category affinity from views and add-to-cart", () => {
    const store = new ProfileStore();
    store.setConsent(true);
    const product = firstProduct();
    store.track("PRODUCT_VIEW", product.id);
    store.track("ADD_TO_CART", product.id);
    const top = store.profile().traits.preferredCategories[0];
    expect(top?.slug).toBe(product.category);
    expect(top?.views).toBe(1);
    expect(top?.carts).toBe(1);
  });
});

describe("consent erase", () => {
  it("clears searches, events and exposures", () => {
    const store = new ProfileStore();
    store.setConsent(true);
    store.syncSearches(["lipstick"]);
    store.track("PRODUCT_VIEW", firstProduct().id);
    store.recordExposure(["1"], "req-1");
    store.setConsent(false);
    expect(store.consent).toBe("DENIED");
    expect(store.searches).toEqual([]);
    expect(store.events).toEqual([]);
    expect(store.exposures).toEqual([]);
    expect(store.recommended().source).toBe("DEFAULT");
  });

  it("does not record events without consent", () => {
    const store = new ProfileStore();
    store.syncSearches(["lipstick"]);
    store.track("PRODUCT_VIEW", firstProduct().id);
    expect(store.searches).toEqual([]);
    expect(store.events).toEqual([]);
  });
});

describe("recommendations", () => {
  it("returns the default row when there is no usable profile", () => {
    const store = new ProfileStore();
    const row = store.recommended();
    expect(row.source).toBe("DEFAULT");
    expect(row.productIds.length).toBeGreaterThan(0);
    expect(row.title.toLowerCase()).toContain("popular");
  });

  it("prefers the viewed category once consent and events exist", () => {
    const store = new ProfileStore();
    store.setConsent(true);
    const product = firstProduct();
    store.track("PRODUCT_VIEW", product.id);
    store.track("PRODUCT_VIEW", product.id);
    const row = store.recommended();
    expect(row.source).toBe("PROFILE");
    expect(row.title).toBe("Recommended for You");
    const top = catalog.products.find((item) => String(item.id) === row.productIds[0]);
    expect(top?.category).toBe(product.category);
    const other = otherCategoryProduct(product.category);
    expect(other.category).not.toBe(product.category);
  });
});

describe("timeout helper", () => {
  it("returns the value and a measured duration when work finishes in time", async () => {
    const result = await withBudget(async () => {
      await delay(10);
      return "ok";
    }, 80);
    expect(result.value).toBe("ok");
    expect(result.fallback).toBeNull();
    expect(Number.isFinite(result.elapsedMs)).toBe(true);
    // setTimeout/performance.now() can resolve a few ms early on CI runners.
    expect(result.elapsedMs).toBeGreaterThanOrEqual(8);
    expect(result.elapsedMs).toBeLessThan(80);
  });

  it("times out and reports the measured wait when work exceeds the budget", async () => {
    const result = await withBudget(async (signal) => {
      await delay(80, signal);
      return "late";
    }, 25);
    expect(result.value).toBeNull();
    expect(result.fallback).toBe("timeout");
    expect(Number.isFinite(result.elapsedMs)).toBe(true);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(20);
  });

  it("keeps the shop's published client budget at 300 ms", () => {
    expect(CLIENT_TIMEOUT_MS).toBe(300);
    expect(SLOW_FAULT_MS).toBeGreaterThan(CLIENT_TIMEOUT_MS);
  });
});

async function graphql(backend: Awaited<ReturnType<typeof createBackend>>, query: string, variables?: Record<string, unknown>) {
  return backend.handle(
    new Request(`http://localhost${GRAPHQL_URL}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, variables }),
    }),
  );
}

describe("backend faults", () => {
  it("returns an injected 503 on outage and leaves recommendations defaultable", async () => {
    const store = new ProfileStore();
    store.setConsent(true);
    store.syncSearches(["phone"]);
    store.faults.outage = true;
    const backend = await createBackend(store);
    const { response, serverMs } = await graphql(backend, "{ viewerProfile { id } }");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.errors[0].extensions.code).toBe("OUTAGE");
    expect(body.errors[0].extensions.injected).toBe(true);
    expect(serverMs).toBeGreaterThanOrEqual(0);
    expect(store.recommended().source).toBe("PROFILE");
  });

  it("honours the kill switch without changing stored history", async () => {
    const store = new ProfileStore();
    store.setConsent(true);
    store.syncSearches(["phone"]);
    store.faults.killSwitch = true;
    const backend = await createBackend(store);
    const { response } = await graphql(backend, "{ recommendedForYou { title source } }");
    const body = await response.json();
    expect(body.errors[0].extensions.code).toBe("KILL_SWITCH");
    expect(store.searches).toEqual(["phone"]);
  });
});
