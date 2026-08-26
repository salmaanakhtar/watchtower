import { test, expect } from "@playwright/test";

test.describe("WT-15 SEO tools", () => {
  test("contract-renewal-analyzer renders copy + preseeded example and analyzes it", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/tools/contract-renewal-analyzer");

    await expect(page.getByTestId("tool-badge")).toContainText("Free contract checker");
    await expect(page.getByTestId("tool-headline")).toContainText(
      "Will your contract auto-renew and cost you more?",
    );

    // The tool page preseeds its example document.
    const input = page.getByTestId("paste-input");
    await expect(input).toHaveValue(/Atlas Software/);

    // Consent + analyze → the example produces a price-increase finding.
    await page.getByTestId("consent-input").check();
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("kind-badge")).toContainText("Price increase");

    // Repeat hook: "Check another document free" resets the tool to a fresh
    // input with the sample still preseeded.
    await page.getByTestId("check-another-button").click();
    await expect(page.getByTestId("paste-input")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("paste-input")).toHaveValue(/Atlas Software/);
    await expect(page.getByTestId("result-card")).not.toBeVisible();
  });

  test("cancellation-deadline-checker analyzes its example", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/tools/cancellation-deadline-checker");

    await expect(page.getByTestId("tool-badge")).toContainText("Free deadline checker");
    await expect(page.getByTestId("paste-input")).toHaveValue(/Ironworks Fitness/);

    await page.getByTestId("consent-input").check();
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("deadline")).toContainText("November 1");
  });

  test("unknown tool slug 404s", async ({ page }) => {
    const res = await page.goto("/tools/not-a-tool");
    expect(res?.status()).toBe(404);
  });
});

test.describe("WT-15 repeat hook on the landing page", () => {
  test("'Check another document free' appears after a result and resets the input", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    await page.getByTestId("paste-input").fill(
      "Your Adobe plan renews on October 14 at $19.99/month. Cancel before then.",
    );
    await page.getByTestId("consent-input").check();
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 15_000 });

    // The repeat CTA is always present after a result (WT-15 §9.5).
    await expect(page.getByTestId("check-another-button")).toBeVisible();
    await page.getByTestId("check-another-button").click();
    await expect(page.getByTestId("paste-input")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("result-card")).not.toBeVisible();
    await expect(page.getByTestId("paste-input")).toHaveValue("");
  });
});
