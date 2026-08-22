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
    await user.click(screen.getByTestId("analyze-button"));
    await screen.findByTestId("processing");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/analyses",
      expect.objectContaining({ method: "POST" }),
    );
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
