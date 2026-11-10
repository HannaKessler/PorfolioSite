import { expect, test } from "@playwright/test";

test("injected outage keeps the default recommended row", async ({ page }) => {
  await page.goto("/projects/catalog");
  const heading = page.locator("#os-recommended h2, #os-recommended-slot h2").first();
  await expect(heading).toBeVisible();
  const defaultTitle = (await heading.textContent())?.trim();
  expect(defaultTitle).toBeTruthy();

  const consent = page.getByRole("button", { name: "Reject" });
  if (await consent.isVisible()) await consent.click();

  const toggle = page.getByRole("button", { name: "Under the Hood" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#os-hood-panel")).toBeVisible();
  await page.locator('[data-fault="outage"]').check();

  await expect(page.locator("[data-hood-fallback]")).toHaveText(/outage/i, { timeout: 10_000 });
  await expect(heading).toHaveText(defaultTitle!);
  const latency = await page.locator("[data-hood-latency]").textContent();
  expect(latency).toMatch(/ms/);
  await expect(page.locator(".os-hood-tag").filter({ hasText: "Injected Fault" })).toHaveCount(2);
});
