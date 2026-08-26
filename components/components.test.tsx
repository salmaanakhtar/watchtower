/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InputZone, type Phase } from "@/components/input-zone";
import { VariantProvider } from "@/components/variant-provider";
import { ResultCard } from "@/components/result-card";
import { WatchButton } from "@/components/watch-button";
import { WatchlistView, type WatchlistItem } from "@/components/watchlist";
import { LedgerView } from "@/components/ledger";
import { ToolPage } from "@/components/tool-page";
import { TOOLS } from "@/lib/tools";
import type { AnalysisResult } from "@/lib/analysis";

function InputZoneHarness({
  onResult,
}: {
  onResult: (r: AnalysisResult | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  return (
    <VariantProvider variantCookie="A">
      <InputZone phase={phase} onPhase={setPhase} onResult={onResult} />
    </VariantProvider>
  );
}

const result: AnalysisResult = {
  kind: "subscription",
  counterparty: "Adobe",
  title: "Recurring subscription detected",
  whyItMatters: "Subscriptions that renew automatically are easy to forget.",
  exposureCentsPerYear: 24000,
  exposureLowCentsPerYear: 24000,
  exposureHighCentsPerYear: 24000,
  exposureAssumption: "$19.99/month × 12 months = $240/year if this renews",
  exposureLabel: "~$240/year if this renews",
  deadline: "October 14",
  recommendation: "Decide before October 14: cancel to stop the next charge.",
  confidence: "certain",
  facts: [
    { label: "Amount", value: "$19.99/month", source: "renews at $19.99", offset: [31, 44] },
    { label: "Deadline", value: "October 14", source: "October 14", offset: [21, 31] },
  ],
};

describe("InputZone", () => {
  it("renders paste and upload tabs", () => {
    render(
      <VariantProvider variantCookie="A">
        <InputZone phase="idle" onPhase={() => {}} onResult={() => {}} />
      </VariantProvider>,
    );
    expect(screen.getByTestId("tab-paste")).toBeInTheDocument();
    expect(screen.getByTestId("tab-file")).toBeInTheDocument();
  });

  it("validates empty paste", async () => {
    const user = userEvent.setup();
    render(<InputZoneHarness onResult={() => {}} />);
    await user.click(screen.getByTestId("analyze-button"));
    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      "Paste the document text first.",
    );
  });

  it("submits pasted text and reports result", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    let resolveFetch: (v: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<InputZoneHarness onResult={onResult} />);
    await user.type(screen.getByTestId("paste-input"), "renews at $19.99/month");
    await user.click(screen.getByTestId("consent-input"));
    await user.click(screen.getByTestId("analyze-button"));
    await screen.findByTestId("processing");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analyses",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.consent).toBe(true);
    resolveFetch!({
      ok: true,
      json: async () => ({
        id: "x",
        result: {
          kind: "subscription",
          counterparty: "Adobe",
          title: "Recurring subscription detected",
          whyItMatters: "Subscriptions that renew automatically are easy to forget.",
          exposureCentsPerYear: 239880,
          exposureLowCentsPerYear: 239880,
          exposureHighCentsPerYear: 239880,
          exposureAssumption: "$19.99/month × 12 months = $240/year if this renews",
          exposureLabel: "~$240/year if this renews",
          deadline: "October 14",
          recommendation: "Decide before October 14.",
          confidence: "certain",
          facts: [],
        },
      }),
    });
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it("reports a queued file as null result with a message", async () => {
    const user = userEvent.setup();
    const onResult = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "q1",
        result: null,
        queued: true,
        message: "PDF extraction is coming soon — queued for manual review.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InputZoneHarness onResult={onResult} />);
    await user.click(screen.getByTestId("tab-file"));
    await user.click(screen.getByTestId("consent-input"));

    const file = new File(["fake pdf"], "bill.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("file-input"), file);

    await waitFor(() => expect(onResult).toHaveBeenCalledWith(null));
    expect(await screen.findByTestId("file-message")).toHaveTextContent("queued for manual review");
    vi.unstubAllGlobals();
  });

  it("rejects oversized files client-side", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<InputZoneHarness onResult={() => {}} />);
    await user.click(screen.getByTestId("tab-file"));
    await user.click(screen.getByTestId("consent-input"));

    const big = new File([new ArrayBuffer(10 * 1024 * 1024 + 1)], "big.txt", {
      type: "text/plain",
    });
    await user.upload(screen.getByTestId("file-input"), big);

    expect(await screen.findByTestId("error-message")).toHaveTextContent("max 10MB");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("ResultCard", () => {
  it("renders the finding with exposure, deadline, and evidence", () => {
    render(<ResultCard result={result} />);
    expect(screen.getByTestId("kind-badge")).toHaveTextContent("Subscription");
    expect(screen.getByTestId("exposure")).toHaveTextContent("$240/year");
    expect(screen.getByTestId("exposure-assumption")).toHaveTextContent("$19.99/month × 12 months");
    expect(screen.getByTestId("deadline")).toHaveTextContent("October 14");
    expect(screen.getByTestId("recommendation")).toHaveTextContent("Decide before");
    expect(screen.getByTestId("evidence-list")).toHaveTextContent("$19.99/month");
  });

  it("toggles the evidence panel", async () => {
    const user = userEvent.setup();
    render(<ResultCard result={result} />);
    const list = screen.getByTestId("evidence-list");
    expect(list).toBeInTheDocument();
    await user.click(screen.getByTestId("evidence-toggle"));
    expect(screen.queryByTestId("evidence-list")).not.toBeInTheDocument();
  });

  it("shows the watch CTA when an obligation id is present (WT-5)", () => {
    render(
      <ResultCard
        result={result}
        obligation={{
          id: "obl_1",
          kind: "subscription",
          counterpartyName: "Adobe",
          amountCents: 23988,
          currency: "USD",
          interval: "yearly",
          riskType: "auto_renewal",
          exposureLowCents: 23988,
          exposureHighCents: 23988,
          exposureAssumption: "$19.99/month × 12 months = $240/year if this renews",
          verification: "certain",
          confidence: 0.92,
          status: "open",
        }}
      />,
    );
    expect(screen.getByTestId("watch-cta")).toBeInTheDocument();
    expect(screen.getByTestId("watch-button")).toBeInTheDocument();
  });
});

describe("WatchButton", () => {
  it("persists a watch when signed in", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ watchItem: { id: "w1" }, needsAccount: false }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WatchButton obligationId="obl_1" />);
    await user.click(screen.getByTestId("watch-button"));
    await screen.findByTestId("watching-state");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/watch",
      expect.objectContaining({ method: "POST" }),
    );
    vi.unstubAllGlobals();
  });

  it("offers email capture for anonymous users", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ watchItem: null, needsAccount: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WatchButton obligationId="obl_1" />);
    await user.click(screen.getByTestId("watch-button"));
    await screen.findByTestId("watch-email-form");
    vi.unstubAllGlobals();
  });

  it("sends a magic link from the email form", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ watchItem: null, needsAccount: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, delivered: true, token: "tok" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    render(<WatchButton obligationId="obl_1" />);
    await user.click(screen.getByTestId("watch-button"));
    await screen.findByTestId("watch-email-form");
    await user.type(screen.getByTestId("watch-email-input"), "a@b.com");
    await user.click(screen.getByTestId("watch-email-submit"));
    await screen.findByTestId("watch-email-sent");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/auth/request",
      expect.objectContaining({ method: "POST" }),
    );
    vi.unstubAllGlobals();
  });
});

const watchItem: WatchlistItem = {
  id: "w1",
  status: "open",
  userNote: null,
  deadlineLabel: "October 14",
  obligation: {
    id: "obl_1",
    kind: "subscription",
    counterpartyName: "Adobe",
    amountCents: 23988,
    currency: "USD",
    interval: "yearly",
    riskType: "auto_renewal",
    exposureLowCents: 23988,
    exposureHighCents: 23988,
    exposureAssumption: "$19.99/month × 12 months = $240/year if this renews",
    verification: "certain",
    confidence: 0.92,
  },
};

describe("WatchlistView", () => {
  it("renders items with status, deadline, and exposure", () => {
    render(<WatchlistView user={{ id: "u1", email: "me@example.com" }} items={[watchItem]} />);
    expect(screen.getByTestId("watchlist")).toBeInTheDocument();
    expect(screen.getByTestId("status-chip")).toHaveTextContent("Open");
    expect(screen.getByText("Adobe")).toBeInTheDocument();
    expect(screen.getByText("October 14")).toBeInTheDocument();
    expect(screen.getByTestId("watchlist-item")).toHaveTextContent("$240/year");
  });

  it("shows the empty state", () => {
    render(<WatchlistView user={{ id: "u1", email: "me@example.com" }} items={[]} />);
    expect(screen.getByTestId("watchlist-empty")).toHaveTextContent("Nothing watched yet");
  });

  it("resolves an item via PATCH", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        watchItem: { id: "w1", status: "resolved", userNote: null },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<WatchlistView user={{ id: "u1", email: "me@example.com" }} items={[watchItem]} />);
    await user.click(screen.getByTestId("resolve-button"));
    await screen.findByText("Resolved");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/watch/w1",
      expect.objectContaining({ method: "PATCH" }),
    );
    vi.unstubAllGlobals();
  });
});

const ledger = {
  totalCents: 34500,
  currency: "USD",
  preventedCents: 24000,
  recoveredCents: 2500,
  avoidedCents: 8000,
  count: 3,
  entries: [
    {
      id: "le1",
      category: "prevented" as const,
      amountCents: 24000,
      currency: "USD",
      note: "Marked resolved — projected cost avoided.",
      source: "manual",
      verification: "verified",
      recordedAt: "2026-08-25T00:00:00.000Z",
      obligation: {
        id: "obl_1",
        kind: "subscription",
        counterpartyName: "Adobe",
        exposureAssumption: "$19.99/month × 12 months = $240/year if this renews",
        exposureLowCents: 24000,
        exposureHighCents: 24000,
      },
    },
    {
      id: "le2",
      category: "recovered" as const,
      amountCents: 2500,
      currency: "USD",
      note: "Got a partial refund",
      source: "manual",
      verification: "verified",
      recordedAt: "2026-08-24T00:00:00.000Z",
      obligation: {
        id: "obl_2",
        kind: "refund",
        counterpartyName: "Netflix",
        exposureAssumption: null,
        exposureLowCents: null,
        exposureHighCents: null,
      },
    },
    {
      id: "le3",
      category: "avoided" as const,
      amountCents: 8000,
      currency: "USD",
      note: "Stopped the price increase",
      source: "manual",
      verification: "pending",
      recordedAt: "2026-08-23T00:00:00.000Z",
      obligation: {
        id: "obl_3",
        kind: "bill",
        counterpartyName: "Comcast",
        exposureAssumption: null,
        exposureLowCents: null,
        exposureHighCents: null,
      },
    },
  ],
};

describe("LedgerView (WT-13)", () => {
  it("renders the total and per-category breakdown", () => {
    render(<LedgerView user={{ email: "me@example.com" }} ledger={ledger} />);
    expect(screen.getByTestId("ledger-total")).toHaveTextContent("$345");
    expect(screen.getByTestId("ledger-category-prevented")).toHaveTextContent("$240");
    expect(screen.getByTestId("ledger-category-recovered")).toHaveTextContent("$25");
    expect(screen.getByTestId("ledger-category-avoided")).toHaveTextContent("$80");
  });

  it("renders each entry with drill-down provenance", () => {
    render(<LedgerView user={{ email: "me@example.com" }} ledger={ledger} />);
    expect(screen.getAllByTestId("ledger-entry")).toHaveLength(3);
    expect(screen.getByText("Adobe")).toBeInTheDocument();
    expect(screen.getByText("Netflix")).toBeInTheDocument();
    expect(screen.getByText("pending verification")).toBeInTheDocument();
  });

  it("shows the empty state", () => {
    render(
      <LedgerView
        user={{ email: "me@example.com" }}
        ledger={{ ...ledger, totalCents: 0, preventedCents: 0, recoveredCents: 0, avoidedCents: 0, count: 0, entries: [] }}
      />,
    );
    expect(screen.getByTestId("ledger-empty")).toHaveTextContent("No protected money yet");
  });
});

describe("WT-15 SEO tool + repeat hook", () => {
  it("InputZone preseeded with a tool sample submits with the tool slug", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "t1",
        result,
        obligation: { id: "obl-1" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <VariantProvider variantCookie="A">
        <InputZone
          phase="idle"
          onPhase={() => {}}
          onResult={() => {}}
          tool="contract-renewal-analyzer"
          defaultSample="Your annual contract renews on October 1 at $1,200 per year."
        />
      </VariantProvider>,
    );
    const input = screen.getByTestId("paste-input") as HTMLTextAreaElement;
    expect(input.value).toContain("$1,200 per year");
    await user.click(screen.getByTestId("consent-input"));
    await user.click(screen.getByTestId("analyze-button"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.tool).toBe("contract-renewal-analyzer");
    expect(body.content).toContain("$1,200 per year");
    vi.unstubAllGlobals();
  });

  it("ToolPage renders the tool's copy and preseeded sample", () => {
    render(
      <VariantProvider variantCookie="A">
        <ToolPage tool={TOOLS["cancellation-deadline-checker"]} />
      </VariantProvider>,
    );
    expect(screen.getByTestId("tool-badge")).toHaveTextContent("Free deadline checker");
    expect(screen.getByTestId("tool-headline")).toHaveTextContent("Is it too late to cancel?");
    const input = screen.getByTestId("paste-input") as HTMLTextAreaElement;
    expect(input.value).toContain("Ironworks Fitness");
  });

  it("ToolPage shows the repeat CTA after a result", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "t2", result, obligation: { id: "obl-2" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <VariantProvider variantCookie="A">
        <ToolPage tool={TOOLS["contract-renewal-analyzer"]} />
      </VariantProvider>,
    );
    await user.click(screen.getByTestId("consent-input"));
    await user.click(screen.getByTestId("analyze-button"));
    expect(await screen.findByTestId("check-another-button")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
