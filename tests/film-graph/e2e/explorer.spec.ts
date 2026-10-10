import { expect, test, type Page } from "@playwright/test";

const DEMO = "/projects/film-graph/";

async function openDemo(page: Page) {
  await page.goto(DEMO);
  await expect(page.getByText("Postgres is running in your browser.")).toBeVisible({ timeout: 60_000 });
  // The first preset runs on load; wait for both columns of the comparison.
  await waitForComparison(page);
}

const cell = (page: Page, metric: string, api: "graphql" | "rest") =>
  page.locator(`.fg-table tr[data-metric="${metric}"] td[data-api="${api}"]`);

async function waitForComparison(page: Page) {
  await expect(page.locator(".fg-compare")).toHaveAttribute("aria-busy", "false");
  await expect(cell(page, "requests", "graphql")).not.toHaveText("–");
  await expect(cell(page, "requests", "rest")).not.toHaveText("–");
}

const number = async (page: Page, metric: string, api: "graphql" | "rest") =>
  Number((await cell(page, metric, api).innerText()).replace(/[^\d]/g, "") || "NaN");

/** The result panels show pretty JSON; GraphQL's body has the data under "data". */
async function resultJson(page: Page, tab: "GraphQL result" | "REST result") {
  await page.getByRole("tab", { name: tab }).click();
  return JSON.parse(await page.locator(".fg-json pre").innerText());
}

test("boots Postgres behind a service worker and answers through it", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByText("Requests go through a service worker")).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const response = await page.evaluate(async () => {
    const res = await fetch("/projects/film-graph/api/rest/films/47703");
    return { status: res.status, etag: res.headers.get("etag"), queries: res.headers.get("x-db-queries"), body: await res.json() };
  });
  expect(response.status).toBe(200);
  expect(response.etag).toMatch(/^"/);
  expect(Number(response.queries)).toBeGreaterThan(0);
  expect(response.body.title).toBe("The Godfather");
});

const PRESETS = [
  { label: "Director with full cast", minRest: 10 },
  { label: "Filmography by decade", minRest: 10 },
  { label: "Films two actors share", minRest: 5 },
  { label: "Studio output by genre", minRest: 3 },
  { label: "Shortest link between two actors", minRest: 3 },
];

test("every preset returns the same data from GraphQL and REST", async ({ page }) => {
  await openDemo(page);
  for (const preset of PRESETS) {
    await page.getByRole("button", { name: preset.label }).click();
    await expect(page.getByRole("button", { name: preset.label })).toHaveAttribute("aria-pressed", "true");
    await waitForComparison(page);
    expect(await number(page, "requests", "graphql"), preset.label).toBe(1);
    expect(await number(page, "requests", "rest"), preset.label).toBeGreaterThanOrEqual(preset.minRest);
    expect(await number(page, "db", "graphql"), preset.label).toBeGreaterThan(0);
    expect(await number(page, "db", "rest"), preset.label).toBeGreaterThan(0);
    const graphql = await resultJson(page, "GraphQL result");
    const rest = await resultJson(page, "REST result");
    expect(rest, preset.label).toEqual(graphql.data);
  }
});

test("running REST again revalidates with ETags", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Run both" }).click();
  await waitForComparison(page);
  const requests = await number(page, "requests", "rest");
  await expect(cell(page, "cached", "rest")).toHaveText(`${requests} of ${requests}`);
  await expect(page.locator(".fg-log-run").first().getByText("ETag hit").first()).toBeVisible();
});

test("N+1 demo: batching cuts 100+ queries to a handful", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Run with batching off, then on" }).click();
  const off = page.locator('[data-n1="off"] .fg-bar-value strong');
  const on = page.locator('[data-n1="on"] .fg-bar-value strong');
  await expect(off).toBeVisible();
  expect(Number((await off.innerText()).replace(/,/g, ""))).toBeGreaterThan(100);
  expect(Number(await on.innerText())).toBeLessThanOrEqual(6);
});

test("persisted queries send a hash and the allowlist rejects other queries", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("switch", { name: /Send persisted query hash/ }).check();
  await page.getByRole("button", { name: "GraphQL only" }).click();
  await expect(page.locator('[data-pq="saved"]')).toContainText("%");
  const sent = await page.locator('[data-pq="sent"]').innerText();
  const full = await page.locator('[data-pq="full"]').innerText();
  expect(sent).not.toBe(full);
  await page.getByRole("button", { name: "Try a query that is not on the list" }).click();
  await expect(page.locator('[data-pq="error"]')).toContainText(/persisted/i);
});

test("the rest of the site is unaffected and never loads Postgres", async ({ page }) => {
  const heavy: string[] = [];
  page.on("request", (request) => {
    if (/pglite|backend\.worker|QueryEditor|film-graph-seed/.test(request.url())) heavy.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Film Graph/ }).first()).toBeAttached();
  await page.goto("/projects/catalog/");
  await expect(page.locator("#open-stock")).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
  await page.goto("/status/");
  expect(heavy).toEqual([]);
});

test("no horizontal overflow at common widths", async ({ page }) => {
  await openDemo(page);
  for (const width of [375, 768, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
  }
});
