import { describe, expect, it } from "vitest";
import { deadlineToIso, daysUntil, parseDeadline } from "@/lib/dates";

describe("parseDeadline (WT-3 shared date primitive)", () => {
  const NOW = new Date("2026-08-22T00:00:00Z");

  it("anchors month-name deadlines to the next occurrence", () => {
    expect(parseDeadline("October 14", NOW)?.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(parseDeadline("January 5", NOW)?.toISOString()).toBe("2027-01-05T00:00:00.000Z");
  });

  it("parses ISO and MM/DD/YYYY", () => {
    expect(parseDeadline("2026-10-14", NOW)?.toISOString()).toBe("2026-10-14T00:00:00.000Z");
    expect(parseDeadline("10/14/2026", NOW)?.toISOString()).toBe("2026-10-14T00:00:00.000Z");
  });

  it("returns null for unparseable input", () => {
    expect(parseDeadline("someday soon", NOW)).toBeNull();
    expect(parseDeadline(null, NOW)).toBeNull();
    expect(parseDeadline("", NOW)).toBeNull();
  });
});

describe("deadlineToIso", () => {
  it("returns an ISO string or null", () => {
    expect(deadlineToIso("October 14", new Date("2026-08-22T00:00:00Z"))).toBe("2026-10-14T00:00:00.000Z");
    expect(deadlineToIso(null)).toBeNull();
  });
});

describe("daysUntil", () => {
  it("counts whole days", () => {
    expect(daysUntil("October 14", new Date("2026-10-01T00:00:00Z"))).toBe(13);
    expect(daysUntil("October 14", new Date("2026-10-14T00:00:00Z"))).toBe(0);
    expect(daysUntil(null, new Date())).toBeNull();
  });
});