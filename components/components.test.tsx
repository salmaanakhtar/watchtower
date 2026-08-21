/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InputZone, type Phase } from "@/components/input-zone";
import { VariantProvider } from "@/components/variant-provider";
import { ResultCard } from "@/components/result-card";
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
});
