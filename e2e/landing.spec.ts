import { test, expect } from "@playwright/test";

test.describe("Landing page variants", () => {
  test("serves a variant with badge, headline, and CTA", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "B", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    await expect(page.getByTestId("badge")).toContainText("Bill-forwarding analyst");
    await expect(page.getByTestId("headline")).toContainText("Forward us your bills");
    await expect(page.getByTestId("subheadline")).toBeVisible();
    await expect(page.getByTestId("variant-badge")).toContainText("Variant B");
  });

  test("variant C renders", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "C", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    await expect(page.getByTestId("badge")).toContainText("AI money watchdog");
    await expect(page.getByTestId("variant-badge")).toContainText("Variant C");
  });
});

test.describe("Paste flow", () => {
  test("analyze pasted text and show result", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");

    const sample =
      "Your Adobe Creative Cloud plan renews on October 14 at $19.99/month. To cancel, do it before the renewal.";
    await page.getByTestId("paste-input").fill(sample);
    await page.getByTestId("analyze-button").click();

    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("kind-badge")).toContainText("Subscription");
    await expect(page.getByTestId("exposure")).toContainText("$240/year");
    await expect(page.getByTestId("deadline")).toContainText("October 14");
    await expect(page.getByTestId("recommendation")).toContainText("Decide before");
    await expect(page.getByTestId("evidence-list")).toContainText("$19.99/month");
  });

  test("empty paste shows validation error", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("error-message")).toHaveText(
      "Paste the document text first.",
    );
  });

  test("try-an-example fills the input", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    await page.getByTestId("try-example").click();
    await expect(page.getByTestId("paste-input")).toHaveValue(/Adobe/);
  });
});

test.describe("Waitlist", () => {
  test("join the list after analysis", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    await page.getByTestId("paste-input").fill(
      "Your plan renews at $9.99/month before December 1.",
    );
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("waitlist-form")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("waitlist-email").fill("e2e@example.com");
    await page.getByTestId("waitlist-submit").click();
    await expect(page.getByTestId("waitlist-done")).toBeVisible({ timeout: 15_000 });
  });

  test("invalid email shows error", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("paste-input").fill("trial ends December 5 at $12.99/month");
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("waitlist-form")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("waitlist-email").fill("not-an-email");
    await page.getByTestId("waitlist-submit").click();
    await expect(page.getByTestId("waitlist-error")).toBeVisible();
  });
});

test.describe("Upload flow", () => {
  test("accepts a .txt file upload", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    await page.getByTestId("tab-file").click();
    await page.getByTestId("file-input").setInputFiles({
      name: "renewal.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Your home insurance policy renews on November 1 at $850 per year. Cancel before then.",
      ),
    });
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("kind-badge")).toContainText("Subscription");
  });
});
