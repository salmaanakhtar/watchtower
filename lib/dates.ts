// WT-3: shared date parsing/normalization for the extraction pipeline.
//
// The deterministic engine emits human-readable dates ("October 14"); the LLM
// emits ISO dates. This module is the deterministic primitive layer that both
// the notification sweep and the canonical mapper use to anchor those into real
// Dates, so deadlines become ISO rows instead of labels.

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MONTH_DAY_RE = /^\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i;
const ISO_RE = /^\s*(\d{4})-(\d{2})-(\d{2})\b/;
const US_RE = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;

/**
 * Parse a human deadline into a real date. The deterministic engine emits
 * "October 14" (no year); we anchor those to the next occurrence (this year if
 * still ahead, otherwise next year). ISO and MM/DD/YYYY are also accepted.
 */
export function parseDeadline(raw: string | null | undefined, now: Date = new Date()): Date | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  const iso = text.match(ISO_RE);
  if (iso) {
    const d = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const us = text.match(US_RE);
  if (us) {
    const d = new Date(Date.UTC(Number(us[3]), Number(us[1]) - 1, Number(us[2])));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = text.match(MONTH_DAY_RE);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  const day = Number(m[2]);
  if (month === undefined || day < 1 || day > 31) return null;

  const currentYear = now.getUTCFullYear();
  let date = new Date(Date.UTC(currentYear, month, day));
  if (date < now) {
    date = new Date(Date.UTC(currentYear + 1, month, day));
  }
  return date;
}

/** Whole days from now until the deadline (negative = overdue, null = unknown). */
export function daysUntil(raw: string | null | undefined, now: Date = new Date()): number | null {
  const date = parseDeadline(raw, now);
  if (!date) return null;
  return Math.ceil((date.getTime() - now.getTime()) / 86_400_000);
}

/** Convert a human/ISO deadline label to an ISO date string, or null. */
export function deadlineToIso(raw: string | null | undefined, now: Date = new Date()): string | null {
  const d = parseDeadline(raw, now);
  return d ? d.toISOString() : null;
}