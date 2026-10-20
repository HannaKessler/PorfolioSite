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

  test("activity, files and prompts views follow the selection", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/projects/agent-trace-viewer/");
    await page.getByRole("button", { name: "Run the agent" }).click();
    const summary = page.getByRole("region", { name: "Run summary" });
    await expect(summary).toContainText("Finished");

    // Activity: the scripted policy's rule, labelled as such, and the test output.
    const panel = page.getByRole("tabpanel");
    await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    await expect(panel).toContainText("Scripted policy decision");
    await expect(panel).toContainText("no tool result yet → run_tests");
    await expect(panel).toContainText("5 passed, 1 failed");
    await expect(panel).not.toContainText("Model's reasoning");

    // Feed → timeline and inspector.
    await panel.getByText("known buggy line found → edit_file with its known fix").click();
    const inspector = page.getByRole("complementary", { name: "Span details" });
    await expect(inspector.getByRole("heading", { level: 3 })).toHaveText(/^chat scripted-v1$/);
    const tree = page.getByRole("tree", { name: "Spans" });
    await expect(tree.locator('[aria-selected="true"]')).toHaveAttribute("data-span-name", "chat scripted-v1");

    // Timeline → files: the edit's diff with the removed and added line.
    await tree.locator('[data-span-name="execute_tool edit_file"]').click();
    await page.getByRole("tab", { name: "Files" }).click();
    await expect(page).toHaveURL(/v=files/);
    await expect(panel.locator(".atv-diff-del")).toContainText("Math.round(totalSeconds % 60)");
    await expect(panel.locator(".atv-diff-add")).toContainText("rounded % 60");
    await expect(panel.locator(".atv-feed-step.is-active, .atv-edit-item.is-selected")).toHaveCount(1);

    // Prompts: the full message list and the raw reply, with copy buttons.
    await tree.locator('[data-span-name="chat scripted-v1"]').last().click();
    await page.getByRole("tab", { name: "Prompts" }).click();
    const open = panel.locator("details.atv-call[open]");
    await expect(open).toHaveCount(1);
    await expect(open).toContainText("Messages sent (10)");
    await expect(open).toContainText("Raw reply, before parsing");
    await expect(open.getByRole("button", { name: "Copy all" })).toBeVisible();
    await expect(open).toContainText("No model was involved");
    expect(errors).toEqual([]);
  });

  test("a failed edit in a recorded trace shows what was attempted", async ({ page }) => {
    await page.goto("/projects/agent-trace-viewer/?run=sample-webllm-qwen2.5-1.5b&v=files");
    const panel = page.getByRole("tabpanel");
    await expect(panel.locator(".atv-edit-item").first()).toBeVisible();
    // The recorded Qwen run repeats an edit whose find text is not in the file.
    await panel.locator(".atv-edit-item.is-error").first().click();
    await expect(panel).toContainText("Not applied: find string not found");
    await expect(panel).toContainText("The find text occurs 0 times in the file");
    await expect(panel).toContainText("Find (as sent by the brain)");
    await expect(panel.locator(".atv-code")).toContainText("export function formatDuration");
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(panel).toContainText("Model's reasoning");
    await expect(panel).not.toContainText("Scripted policy decision");
    await page.getByRole("tab", { name: "Prompts" }).click();
    await panel.locator("details.atv-call > summary").first().click();
    await expect(panel).toContainText("Exact request body sent to WebLLM");
  });

  test("bundled samples load and can be filtered", async ({ page }) => {
    await page.goto("/projects/agent-trace-viewer/?run=sample-scripted-malformed&f=errors");
    const tree = page.getByRole("tree", { name: "Spans" });
    await expect(tree.locator('[data-span-name^="chat "]').first()).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Errors only" })).toBeChecked();
    await expect(tree.getByText("fault").first()).toBeVisible();
  });
});
