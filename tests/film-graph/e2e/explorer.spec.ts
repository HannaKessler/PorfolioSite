import { expect, test, type Page } from "@playwright/test";

const DEMO = "/projects/film-graph/";
/** Anything that means the backend did work: API calls, Postgres, the worker or the seed. */
const BACKEND = /\/api\/|pglite|\.wasm|backend\.worker|film-graph-seed/;

const cell = (page: Page, metric: string, api: "graphql" | "rest") =>
  page.locator(`.fg-table tr[data-metric="${metric}"] td[data-api="${api}"]`);

const number = async (page: Page, metric: string, api: "graphql" | "rest") =>
  Number((await cell(page, metric, api).innerText()).replace(/[^\d]/g, "") || "NaN");

const answer = (page: Page) => page.locator(".fg-answer");

/** Presses Run and waits for that run's results (the answer's run counter moves on). */
async function runQuestion(page: Page) {
  const before = Number((await answer(page).getAttribute("data-run")) ?? "0");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(answer(page)).toHaveAttribute("data-run", String(before + 1), { timeout: 90_000 });
  await expect(page.locator(".fg-compare")).toHaveAttribute("aria-busy", "false");
}

async function openAndRun(page: Page) {
  await page.goto(DEMO);
  await runQuestion(page);
  await expect(page.getByText("Postgres is running in your browser:")).toBeVisible();
  // The setup banner goes away once the database is ready.
  await expect(page.locator(".fg-banner")).toHaveCount(0);
}

/** The result panels show pretty JSON; GraphQL's body has the data under "data". */
async function resultJson(page: Page, tab: "GraphQL result" | "REST result") {
  await page.getByRole("tab", { name: tab }).click();
  return JSON.parse(await page.locator(".fg-json pre").innerText());
}

const question = (page: Page, name: RegExp) => page.getByRole("button", { name });

/** Types into a name blank, checks the suggestion list, and picks with the keyboard. */
async function fillBlank(page: Page, label: string, text: string, expected: string) {
  const box = page.getByRole("combobox", { name: label, exact: true });
  await box.click();
  await box.fill(text);
  const option = page.getByRole("option", { name: new RegExp(expected) }).first();
  await expect(option).toBeVisible({ timeout: 90_000 });
  await expect(box).toHaveAttribute("aria-expanded", "true");
  // Move the highlight to the expected suggestion, then Enter.
  for (let i = 0; i < 8 && (await option.getAttribute("aria-selected")) !== "true"; i++) await box.press("ArrowDown");
  await box.press("Enter");
  await expect(box).toHaveValue(expected);
  await expect(box).toHaveAttribute("aria-expanded", "false");
}

test("nothing loads or runs until the visitor acts", async ({ page }) => {
  const backend: string[] = [];
  page.on("request", (request) => {
    if (BACKEND.test(request.url())) backend.push(request.url());
  });
  await page.goto(DEMO);
  await expect(page.getByText("Pick a question, fill in the names, and press Run.")).toBeVisible();
  // No status banner at all before the visitor acts.
  await expect(page.locator(".fg-banner")).toHaveCount(0);
  // Pre-filled names are baked into the page: no lookup needed to show them.
  await expect(page.getByRole("combobox", { name: "Director" })).toHaveValue("Christopher Nolan");
  // Picking another question doesn't run anything either.
  await question(page, /Shortest link between/).click();
  await expect(page.getByRole("combobox", { name: "First actor" })).toHaveValue("Kevin Bacon");
  await page.waitForTimeout(1500);
  expect(backend).toEqual([]);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await expect(page.getByText("Press Run to see the response.")).toBeVisible();
});

test("Run boots Postgres behind a service worker and answers through it", async ({ page }) => {
  await openAndRun(page);
  await expect(page.getByText("Requests go through a service worker")).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(answer(page)).toContainText("Christopher Nolan directed");
  const response = await page.evaluate(async () => {
    const res = await fetch("/projects/film-graph/api/rest/films/47703");
    return { status: res.status, etag: res.headers.get("etag"), queries: res.headers.get("x-db-queries"), body: await res.json() };
  });
  expect(response.status).toBe(200);
  expect(response.etag).toMatch(/^"/);
  expect(Number(response.queries)).toBeGreaterThan(0);
  expect(response.body.title).toBe("The Godfather");
});

const QUESTIONS = [
  { name: /^Every film director directed/, minRest: 10, answer: /Christopher Nolan directed \d+ films/ },
  { name: /films, by decade/, minRest: 10, answer: /Tom Hanks has \d+ acting credits/ },
  { name: /^Films actor and actor both appear in/, minRest: 5, answer: /Robert De Niro and Al Pacino appear together in \d+ films/ },
  { name: /^What studio made/, minRest: 3, answer: /Warner Bros\. Entertainment made \d+ films/ },
  { name: /^Shortest link between/, minRest: 3, answer: /Kevin Bacon is \d films? away from Marilyn Monroe/ },
];

test("every question answers, and GraphQL and REST return the same data", async ({ page }) => {
  await page.goto(DEMO);
  for (const item of QUESTIONS) {
    await question(page, item.name).click();
    await expect(question(page, item.name)).toHaveAttribute("aria-pressed", "true");
    await runQuestion(page);
    await expect(answer(page).locator(".fg-ans-summary")).toContainText(item.answer);
    expect(await number(page, "requests", "graphql"), String(item.name)).toBe(1);
    expect(await number(page, "requests", "rest"), String(item.name)).toBeGreaterThanOrEqual(item.minRest);
    expect(await number(page, "db", "graphql"), String(item.name)).toBeGreaterThan(0);
    const graphql = await resultJson(page, "GraphQL result");
    const rest = await resultJson(page, "REST result");
    expect(rest, String(item.name)).toEqual(graphql.data);
  }
  await expect(answer(page).locator(".fg-chain-person").first()).toHaveText("Kevin Bacon");
  await expect(answer(page).locator(".fg-chain-person").last()).toHaveText("Marilyn Monroe");
});

test("names are searched as you type, and only Run runs the new question", async ({ page }) => {
  await page.goto(DEMO);
  await question(page, /^Films actor and actor both appear in/).click();
  await fillBlank(page, "First actor", "tom han", "Tom Hanks");
  // Suggestions show disambiguating detail and come from GraphQL search.
  const second = page.getByRole("combobox", { name: "Second actor" });
  await second.fill("meg");
  await expect(page.getByRole("option", { name: /Meg Ryan/ })).toContainText("b. 1961");
  await expect(page.locator(".fg-combo-status:visible").filter({ hasText: "POST /graphql" })).toBeVisible();
  await second.press("Escape");
  await fillBlank(page, "Second actor", "meg ryan", "Meg Ryan");
  // The editor and variables reflect the picks before anything runs.
  await expect(page.getByLabel(/^Variables/)).toHaveValue(/"a": "2263"[\s\S]*"b": "167498"/);
  await expect(answer(page)).toHaveAttribute("data-state", "idle");
  await runQuestion(page);
  await expect(answer(page).locator(".fg-ans-summary")).toContainText("Tom Hanks and Meg Ryan appear together in");
  await expect(answer(page).locator(".fg-ans-films > li").first()).toContainText("Tom Hanks");
  // Accents are optional when searching.
  await question(page, /films, by decade/).click();
  await fillBlank(page, "Actor", "penelope cruz", "Penélope Cruz");
});

test("changing the question marks results out of date instead of re-running", async ({ page }) => {
  await openAndRun(page);
  const apiCalls: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/rest\//.test(request.url())) apiCalls.push(request.url());
  });
  await question(page, /^What studio made/).click();
  await expect(page.getByText("Out of date: you changed the question. Press Run to update.")).toBeVisible();
  await expect(answer(page)).toContainText("Christopher Nolan directed");
  await page.waitForTimeout(800);
  expect(apiCalls).toEqual([]);
  await runQuestion(page);
  await expect(page.locator(".fg-ans-stale")).toHaveCount(0);
  await expect(answer(page)).toContainText("Warner Bros. Entertainment made");
});

test("Ctrl+Enter in the editor counts as Run", async ({ page }) => {
  await page.goto(DEMO);
  const editor = page.locator(".fg-editor .cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press("Control+Enter");
  await expect(answer(page)).toHaveAttribute("data-run", "1", { timeout: 90_000 });
  await expect(answer(page)).toContainText("Christopher Nolan directed");
});

test("answers show every result in full, with nothing collapsed", async ({ page }) => {
  await page.goto(DEMO);
  await question(page, /films, by decade/).click();
  await runQuestion(page);
  const { data } = await resultJson(page, "GraphQL result");
  const decades = data.person.byDecade;
  const credits = decades.reduce((sum: number, group: any) => sum + group.credits.length, 0);
  await expect(answer(page).locator(".fg-ans-decades > li")).toHaveCount(decades.length);
  await expect(answer(page).locator(".fg-ans-credits > li")).toHaveCount(credits);
  await expect(answer(page).getByRole("button", { name: /Show/ })).toHaveCount(0);
  // Nothing in the answer is clipped: every element's content fits its box.
  const clipped = await answer(page).evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>("*")].filter((el) => {
      const style = getComputedStyle(el);
      return style.textOverflow === "ellipsis" || (style.overflowY === "hidden" && el.scrollHeight > el.clientHeight + 1);
    }).length,
  );
  expect(clipped).toBe(0);
});

test("running again revalidates REST with ETags", async ({ page }) => {
  await openAndRun(page);
  await runQuestion(page);
  const requests = await number(page, "requests", "rest");
  await expect(cell(page, "cached", "rest")).toHaveText(`${requests} of ${requests}`);
  await expect(page.locator(".fg-log-run").first().getByText("ETag hit").first()).toBeVisible();
});

test("N+1 demo: batching cuts 100+ queries to a handful", async ({ page }) => {
  await page.goto(DEMO);
  await page.getByRole("button", { name: "Run with batching off, then on" }).click();
  const off = page.locator('[data-n1="off"] .fg-bar-value strong');
  const on = page.locator('[data-n1="on"] .fg-bar-value strong');
  await expect(off).toBeVisible({ timeout: 90_000 });
  expect(Number((await off.innerText()).replace(/,/g, ""))).toBeGreaterThan(100);
  expect(Number(await on.innerText())).toBeLessThanOrEqual(6);
});

test("persisted queries send a hash and the allowlist rejects other queries", async ({ page }) => {
  await openAndRun(page);
  await page.getByRole("switch", { name: /Send persisted query hash/ }).check();
  await page.getByRole("button", { name: "GraphQL only" }).click();
  await expect(page.locator('[data-pq="saved"]')).toContainText("%");
  const sent = await page.locator('[data-pq="sent"]').innerText();
  const full = await page.locator('[data-pq="full"]').innerText();
  expect(sent).not.toBe(full);
  await page.getByRole("button", { name: "Try a query that is not on the list" }).click();
  await expect(page.locator('[data-pq="error"]')).toContainText(/persisted/i);
  // Name search is on the allowlist too, so it keeps working in allowlist mode.
  await page.getByRole("switch", { name: /Reject non-persisted queries/ }).check();
  await fillBlank(page, "Director", "spielberg", "Steven Spielberg");
});

test("the rest of the site is unaffected and never loads Postgres", async ({ page }) => {
  const heavy: string[] = [];
  page.on("request", (request) => {
    if (BACKEND.test(request.url()) || /QueryEditor/.test(request.url())) heavy.push(request.url());
  });
  await page.goto("/");
  await expect(page.getByRole("link", { name: /Film Graph/ }).first()).toBeAttached();
  await page.goto("/projects/catalog/");
  await expect(page.locator("#open-stock")).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
  await page.goto("/status/");
  expect(heavy).toEqual([]);
});

test("no horizontal overflow at common widths, including with a dropdown open", async ({ page }) => {
  await openAndRun(page);
  for (const width of [375, 768, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${width}px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 375, height: 800 });
  const box = page.getByRole("combobox", { name: "Director" });
  await box.fill("chris");
  const list = page.getByRole("listbox");
  await expect(list.getByRole("option").first()).toBeVisible();
  const rect = await list.boundingBox();
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(rect!.x + rect!.width).toBeLessThanOrEqual(375);
});
