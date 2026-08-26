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
    await page.getByTestId("consent-input").check();
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

test.describe("WT-12 email forwarding", () => {
  test("provision, copy, rotate, and disable a forwarding address", async ({ page, context }) => {
    // Sign in via the API to get a session cookie
    const request = await context.request.post("http://127.0.0.1:3100/api/auth/request", {
      data: { email: `wt12-${Date.now()}@example.com` },
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

    await page.goto("/forwarding");
    await expect(page.getByTestId("forwarding-empty")).toBeVisible({ timeout: 15_000 });

    // Provision a fresh address
    await page.getByTestId("provision-address").click();
    await expect(page.getByTestId("forwarding-address")).toBeVisible({ timeout: 15_000 });
    const address = (await page.getByTestId("forwarding-address").textContent()) ?? "";
    expect(address).toMatch(/^u-[0-9a-f]{32}@in\.watchtower\.salmaan\.dev$/);

    // The forwarding link is present on the watchlist page
    await page.goto("/watchlist");
    await expect(page.getByTestId("forwarding-link")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("forwarding-link").click();
    await expect(page).toHaveURL(/\/forwarding/, { timeout: 15_000 });

    // Rotate: new address, old one disabled
    await page.getByTestId("rotate-address").click();
    await expect(page.getByTestId("forwarding-address")).not.toContainText(address, {
      timeout: 15_000,
    });
    const rotated = (await page.getByTestId("forwarding-address").textContent()) ?? "";
    expect(rotated).not.toBe(address);
    expect(rotated).toMatch(/^u-[0-9a-f]{32}@in\.watchtower\.salmaan\.dev$/);

    // Disable: address disappears, empty state returns
    await page.getByTestId("disable-address").click();
    await expect(page.getByTestId("forwarding-empty")).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("WT-13 money-protected ledger", () => {
  test("resolve records money protected; ledger page shows it traced to the source", async ({
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

    // Sign in and watch the obligation
    await page.getByTestId("watch-button").click();
    await expect(page.getByTestId("watch-email-form")).toBeVisible({ timeout: 15_000 });
    const email = `wt13-${Date.now()}@example.com`;
    await page.getByTestId("watch-email-input").fill(email);
    await page.getByTestId("watch-email-submit").click();
    await expect(page.getByTestId("watch-email-sent")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("watch-email-sent").locator("a").click();
    await expect(page).toHaveURL(/\/watch\?obligation=/, { timeout: 15_000 });
    await page.getByTestId("view-watchlist").click();

    // Resolve the item -> records a "prevented" entry
    await expect(page.getByTestId("watchlist")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("resolve-button").click();
    await expect(page.getByTestId("status-chip")).toContainText("Resolved", {
      timeout: 15_000,
    });

    // Watchlist header shows the money-protected total and links to the ledger
    await expect(page.getByTestId("ledger-link")).toContainText("Money protected");
    await page.getByTestId("ledger-link").click();
    await expect(page).toHaveURL(/\/ledger/, { timeout: 15_000 });

    // Ledger shows the total and the entry traced to Adobe
    await expect(page.getByTestId("ledger-total")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("ledger-category-prevented")).toContainText("$240");
    await expect(page.getByTestId("ledger-entry")).toContainText("Adobe");
    await expect(page.getByTestId("ledger-entry")).toContainText("Prevented");
  });

  test("ledger requires a session", async ({ page }) => {
    await page.goto("/ledger");
    await expect(page).toHaveURL(/\?auth=required/, { timeout: 15_000 });
  });
});

test.describe("WT-6 email + notifications", () => {
  test("magic-link email round trip via stub sender", async ({ page, context }) => {
    await context.request.post("http://127.0.0.1:3100/api/admin/test-email-stub", {
      data: { enabled: true },
    });
    try {
      await page.goto("/");
      await page.getByTestId("paste-input").fill(
        "Your Adobe plan renews on October 14 at $19.99/month. Cancel before then.",
      );
      await page.getByTestId("consent-input").check();
    await page.getByTestId("analyze-button").click();
      await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 15_000 });

      await page.getByTestId("watch-button").click();
      await expect(page.getByTestId("watch-email-form")).toBeVisible({ timeout: 15_000 });

      const email = `wt6-${Date.now()}@example.com`;
      await page.getByTestId("watch-email-input").fill(email);
      await page.getByTestId("watch-email-submit").click();

      // The email "arrives": the stub captured it. Fetch the one for our address.
      await expect(page.getByTestId("watch-email-sent")).toBeVisible({ timeout: 15_000 });
      const captured = await context.request.get("http://127.0.0.1:3100/api/admin/test-email-stub");
      const { emails } = await captured.json();
      const mine = (emails as { to: string; text: string }[]).find((e) => e.to === email);
      expect(mine).toBeTruthy();
      const verifyPath = mine!.text.match(/\/api\/auth\/verify\/([^\s]+)/)?.[0];
      expect(verifyPath).toBeTruthy();

      // Sign in through the emailed link.
      await context.request.get(`http://127.0.0.1:3100${verifyPath}`, { maxRedirects: 0 });
      const resp = await context.request.get("http://127.0.0.1:3100/api/auth/me");
      const me = await resp.json();
      expect(me.user.email).toBe(email);
    } finally {
      await context.request.post("http://127.0.0.1:3100/api/admin/test-email-stub", {
        data: { enabled: false },
      });
    }
  });

  test("one-click unwatch link dismisses the item", async ({ page, context }) => {
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
    await page.getByTestId("watch-button").click();
    await expect(page.getByTestId("watch-email-form")).toBeVisible({ timeout: 15_000 });
    const email = `wt6-un-${Date.now()}@example.com`;
    await page.getByTestId("watch-email-input").fill(email);
    await page.getByTestId("watch-email-submit").click();
    const link = page.getByTestId("watch-email-sent").locator("a");
    await link.click();
    await expect(page).toHaveURL(/\/watch\?obligation=/, { timeout: 15_000 });

    await page.getByTestId("view-watchlist").click();
    await expect(page.getByTestId("watchlist")).toBeVisible({ timeout: 15_000 });
    const item = page.getByTestId("watchlist-item");
    await expect(item).toContainText("Adobe");

    // The notification sweep is driven by the real deadline (Oct 14, weeks
    // out), so mint the unwatch link via the admin helper on this item.
    const watchItemId = await page
      .getByTestId("watchlist-item")
      .getAttribute("data-item-id");
    expect(watchItemId).toBeTruthy();
    const mint = await context.request.post("http://127.0.0.1:3100/api/admin/unwatch-token", {
      data: { watchItemId },
    });
    const { url } = await mint.json();
    expect(url).toContain("/api/unwatch/");

    await page.goto(url);
    await expect(page).toHaveURL(/\/api\/unwatch\//, { timeout: 15_000 });
    await expect(page.locator("body")).toContainText("Stopped watching", { timeout: 15_000 });

    // The item is dismissed in the watchlist now.
    await page.goto("/watchlist");
    await expect(page.getByTestId("status-chip")).toContainText("Dismissed", { timeout: 15_000 });
  });
});

test.describe("WT-14 deadline reminders", () => {
  test("a watch item with a near deadline generates exactly one reminder and advances the lifecycle", async ({
    page,
    context,
  }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    // Inside the T-7 window. Use a human-style month-day deadline that the
    // deterministic analyzer recognizes (it doesn't parse ISO dates).
    const near = new Date(Date.now() + 5 * 86_400_000);
    const monthDay = near.toLocaleDateString("en-US", { month: "long", day: "numeric" });
    await page.getByTestId("paste-input").fill(
      `Your Adobe plan renews on ${monthDay} at $19.99/month. Cancel before then.`,
    );
    await page.getByTestId("consent-input").check();
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("watch-button").click();
    await expect(page.getByTestId("watch-email-form")).toBeVisible({ timeout: 15_000 });
    const email = `wt14-${Date.now()}@example.com`;
    await page.getByTestId("watch-email-input").fill(email);
    await page.getByTestId("watch-email-submit").click();
    await expect(page.getByTestId("watch-email-sent")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("watch-email-sent").locator("a").click();
    await expect(page).toHaveURL(/\/watch\?obligation=/, { timeout: 15_000 });

    // Capture the watch item id from the watchlist (data-item-id).
    await page.getByTestId("view-watchlist").click();
    await expect(page.getByTestId("watchlist")).toBeVisible({ timeout: 15_000 });
    const watchItemId = await page.getByTestId("watchlist-item").getAttribute("data-item-id");
    expect(watchItemId).toBeTruthy();

    // Enable the stub sender, then trigger the sweep.
    await context.request.post("http://127.0.0.1:3100/api/admin/test-email-stub", {
      data: { enabled: true },
    });
    try {
      const sweep = await context.request.get("http://127.0.0.1:3100/api/notify/sweep");
      const stats = await sweep.json();
      expect(stats.sent).toBeGreaterThanOrEqual(1);

      const captured = await context.request.get("http://127.0.0.1:3100/api/admin/test-email-stub");
      const { emails } = await captured.json();
      const mine = (emails as { to: string; subject: string; text: string }[]).find(
        (e) => e.to === email && e.text.includes("Adobe"),
      );
      expect(mine).toBeTruthy();
      expect(mine!.subject).toContain("Adobe");

      // The item advanced from open → upcoming (reminder sent at T-7).
      const list = await context.request.get("http://127.0.0.1:3100/api/watchlist");
      const { watchItems } = await list.json();
      const item = (watchItems as { id: string; status: string }[]).find(
        (w) => w.id === watchItemId,
      );
      expect(item).toBeTruthy();
      expect(item!.status).toBe("upcoming");

      // A second sweep must not re-send (idempotent cadence guard). Count
      // only reminder emails (the magic-link email also goes to this address).
      await context.request.get("http://127.0.0.1:3100/api/notify/sweep");
      const captured2 = await context.request.get("http://127.0.0.1:3100/api/admin/test-email-stub");
      const { emails: emails2 } = await captured2.json();
      const reminders = (emails2 as { to: string; subject: string }[]).filter(
        (e) => e.to === email && e.subject.includes("Adobe"),
      ).length;
      expect(reminders).toBe(1);
    } finally {
      await context.request.post("http://127.0.0.1:3100/api/admin/test-email-stub", {
        data: { enabled: false },
      });
    }
  });
});


