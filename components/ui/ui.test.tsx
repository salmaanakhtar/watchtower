/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./badge";
import { Button, buttonClasses } from "./button";
import { Card } from "./card";
import { EmptyState } from "./empty-state";
import { StatusChip, statusTone } from "./status-chip";

describe("EmptyState", () => {
  it("renders title, body, and action", () => {
    render(
      <EmptyState title="Nothing watched yet" testId="empty">
        Upload a bill to begin.
        <button>Go</button>
      </EmptyState>,
    );
    expect(screen.getByTestId("empty")).toHaveTextContent("Nothing watched yet");
    expect(screen.getByTestId("empty")).toHaveTextContent("Upload a bill");
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });
});

describe("Button", () => {
  it("renders primary by default with guardian styling", () => {
    render(<Button data-testid="btn">Save</Button>);
    expect(screen.getByTestId("btn").className).toContain("--wt-guardian-600");
  });

  it("supports all four hierarchy variants", () => {
    for (const v of ["primary", "secondary", "ghost", "danger"] as const) {
      expect(buttonClasses(v)).toMatch(/wt-/);
    }
    expect(buttonClasses("danger")).toContain("--wt-alert-600");
    expect(buttonClasses("secondary")).toContain("border");
  });

  it("is disabled-aware via shared classes", () => {
    expect(buttonClasses()).toContain("disabled:opacity-50");
  });
});

describe("Badge", () => {
  it("renders solid tone fills and a text label", () => {
    render(<Badge tone="alert" testId="b">Act now</Badge>);
    expect(screen.getByTestId("b")).toHaveTextContent("Act now");
    expect(screen.getByTestId("b").className).toContain("--wt-alert-100");
  });

  it("renders dashed variant without a fill (hypothetical)", () => {
    render(<Badge variant="dashed" testId="d">Possible</Badge>);
    expect(screen.getByTestId("d").className).toContain("border-dashed");
  });
});

describe("StatusChip", () => {
  it("maps lifecycle statuses to semantic tones", () => {
    expect(statusTone("due")).toMatchObject({ tone: "alert", label: "Due" });
    expect(statusTone("resolved")).toMatchObject({ tone: "save" });
    expect(statusTone("open")).toMatchObject({ tone: "warn" });
  });

  it("pairs the status dot color with a text label", () => {
    render(<StatusChip status="due" testId="s" />);
    expect(screen.getByTestId("s")).toHaveTextContent("Due");
    expect(screen.getByTestId("s").querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("falls back to neutral for unknown statuses", () => {
    expect(statusTone("mystery")).toMatchObject({ tone: "neutral" });
  });
});

describe("Card", () => {
  it("renders a bordered paper surface", () => {
    render(<Card>content</Card>);
    expect(screen.getByText("content").className).toContain("bg-(--wt-paper-0)");
    expect(screen.getByText("content").className).toContain("border-(--wt-ink-300)");
  });
});
