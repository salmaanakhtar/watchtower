import { test, expect } from "@playwright/test";

function makeMinimalPdf(text: string): Buffer {
  const objs = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${100} >> stream\nBT /F1 18 Tf 72 720 Td (${text}) Tj ET\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let content = "%PDF-1.4\n";
  const offsets = [0];
  for (const o of objs) {
    offsets.push(Buffer.byteLength(content));
    content += o + "\n";
  }
  const xrefStart = Buffer.byteLength(content);
  content += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) {
    content += String(offsets[i]).padStart(10, "0") + " 00000 n \n";
  }
  content += "trailer << /Size 6 /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF";
  return Buffer.from(content, "utf8");
}

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
    await page.getByTestId("consent-input").check();
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
  test("join the list after a no-risk analysis", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    // A document with no renewal/price/deadline yields kind "none", which
    // shows the waitlist CTA (WT-5: watch CTA replaces it for watchable items).
    await page.getByTestId("paste-input").fill(
      "Dear customer, thank you for your purchase of a lawnmower. It will arrive within 5 business days.",
    );
    await page.getByTestId("consent-input").check();
    await page.getByTestId("analyze-button").click();
    await expect(page.getByTestId("waitlist-form")).toBeVisible({ timeout: 15_000 });

    await page.getByTestId("waitlist-email").fill("e2e@example.com");
    await page.getByTestId("waitlist-submit").click();
    await expect(page.getByTestId("waitlist-done")).toBeVisible({ timeout: 15_000 });
  });

  test("invalid email shows error", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("paste-input").fill(
      "Dear customer, thank you for your purchase. It will arrive within 5 business days.",
    );
    await page.getByTestId("consent-input").check();
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
    await page.getByTestId("consent-input").check();
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

  test("queues a PDF upload with an honest message (no fake result)", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    await page.getByTestId("tab-file").click();
    await page.getByTestId("consent-input").check();
    await page.getByTestId("file-input").setInputFiles({
      name: "bill.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< >>\n%%EOF"),
    });
    await expect(page.getByTestId("file-message")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("file-message")).toContainText("queued for manual review");
    await expect(page.getByTestId("result-card")).not.toBeVisible();
  });

  test("extracts a real PDF's text layer and shows a result", async ({ page, context }) => {
    await context.addCookies([
      { name: "wt_variant", value: "A", url: "http://127.0.0.1:3100" },
    ]);
    await page.goto("/");
    await page.getByTestId("tab-file").click();
    await page.getByTestId("consent-input").check();
    await page.getByTestId("file-input").setInputFiles({
      name: "insurance.pdf",
      mimeType: "application/pdf",
      buffer: makeMinimalPdf("Your home insurance policy renews on November 1 at $850 per year."),
    });
    await expect(page.getByTestId("result-card")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("kind-badge")).toContainText("Subscription");
  });
});
