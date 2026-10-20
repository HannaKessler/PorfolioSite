import { expect, test } from "@playwright/test";

// Smoke test for the Agent Trace Viewer: the page loads, a scripted run really
// executes in the browser's workers, and its trace reaches the timeline.
test.describe("Agent Trace Viewer", () => {
  test("a scripted run produces a trace that ends with finish", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/projects/agent-trace-viewer/");

    const run = page.getByRole("button", { name: "Run the agent" });
    await expect(run).toBeEnabled();
    await run.click();

    const tree = page.getByRole("tree", { name: "Spans" });
    await expect(tree.locator('[data-span-name="execute_tool finish"]')).toBeVisible();
    await expect(page.getByRole("region", { name: "Run summary" })).toContainText("Finished");
    await expect(page.getByRole("region", { name: "Run summary" })).toContainText("6 passed, 0 failed");
    // The simulated brain reports no tokens, so none are shown.
    await expect(page.getByRole("region", { name: "Run summary" })).toContainText("Not reported by this brain");
    await expect(page.getByText("What would this run cost on a hosted model?")).toHaveCount(0);

    // Inspect a model call: no usage, but the recorded prompt and response.
    await tree.locator('[data-span-name^="chat "]').first().click();
    const inspector = page.getByRole("complementary", { name: "Span details" });
    await expect(inspector).toContainText("Not reported by this brain");
    await expect(inspector).toContainText("Prompt");

    // The view is in the URL.
    await expect(page).toHaveURL(/run=live-[0-9a-f]{16}.*span=[0-9a-f]{16}/);

    // Export warns that prompts and responses are included.
    await page.getByRole("button", { name: "Export" }).click();
    await expect(page.getByRole("dialog")).toContainText("prompts and model responses");
    expect(errors).toEqual([]);
  });

  test("bundled samples load and can be filtered", async ({ page }) => {
    await page.goto("/projects/agent-trace-viewer/?run=sample-scripted-malformed&f=errors");
    const tree = page.getByRole("tree", { name: "Spans" });
    await expect(tree.locator('[data-span-name^="chat "]').first()).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Errors only" })).toBeChecked();
    await expect(tree.getByText("fault").first()).toBeVisible();
  });
});
