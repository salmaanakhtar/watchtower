import { test, expect } from "@playwright/test";

test.describe("Watch flow (WT-5)", () => {
  test("analyze -> watch -> sign in -> watchlist shows the item", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");

    // Analyze a document with a watchable finding
    await page.getByTestId("paste-input").fill(
      "Your Adobe plan renews on October 14 at $19.99/month. Cancel before then.",
    );
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 15_000 });

    // Click "Watch this for me" -> email capture (anonymous)
    await expect(page.getByTestId("watch-button")).toBeVisible();
    await page.getByTestId("watch-button").click();
    await expect(page.getByTestId("watch-email-form")).toBeVisible({ timeout: 15_000 });

    // Request a magic link (dev mode returns the token in the response; the
    // UI shows a "complete sign-in" link)
    const email = `wt5-${Date.now()}@example.com`;
    await page.getByTestId("watch-email-input").fill(email);
    await page.getByTestId("watch-email-submit").click();
    await expect(page.getByTestId("watch-email-sent")).toBeVisible({ timeout: 15_000 });

    // Follow the dev magic link -> session cookie set, redirected to /watch
    // with the pending obligation (auto-links it), then the confirmation.
    const link = page.getByTestId("watch-email-sent").locator("a");
    await link.click();

    await expect(page).toHaveURL(/\/watch\?obligation=/, { timeout: 15_000 });
    await expect(page.getByTestId("watch-confirmation")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("watch-confirmation")).toContainText("Adobe");

    // Go to the watchlist and verify the item
    await page.getByTestId("view-watchlist").click();
    await expect(page).toHaveURL(/\/watchlist/, { timeout: 15_000 });
    await expect(page.getByTestId("watchlist")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("watchlist-item")).toContainText("Adobe");
    await expect(page.getByTestId("status-chip")).toContainText("Open");

    // Resolve the item
    await page.getByTestId("resolve-button").click();
    await expect(page.getByTestId("status-chip")).toContainText("Resolved", {
      timeout: 15_000,
    });
  });

  test("watchlist requires a session", async ({ page }) => {
    await page.goto("/watchlist");
    await expect(page).toHaveURL(/\?auth=required/, { timeout: 15_000 });
  });

  test("empty watchlist shows the empty state", async ({ page, context }) => {
    // Sign in directly via the API to get a session cookie
    const request = await context.request.post("http://127.0.0.1:3100/api/auth/request", {
      data: { email: `empty-${Date.now()}@example.com` },
    });
    const { token } = await request.json();
    const resp = await context.request.get(
      `http://127.0.0.1:3100/api/auth/verify/${token}`,
      { maxRedirects: 0 },
    );
    const setCookie = resp.headers()["set-cookie"] ?? "";
    const session = setCookie.match(/wt_session=([^;]+)/)?.[1] ?? "";
    await context.addCookies([
      { name: "wt_session", value: decodeURIComponent(session), url: "http://127.0.0.1:3100" },
    ]);

    await page.goto("/watchlist");
    await expect(page.getByTestId("watchlist-empty")).toBeVisible({ timeout: 15_000 });
  });
});
