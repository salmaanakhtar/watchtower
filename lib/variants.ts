export interface VariantCopy {
  badge: string;
  headline: string;
  subheadline: string;
  cta: string;
}

export const VARIANTS: Record<string, VariantCopy> = {
  A: {
    badge: "Money watchdog",
    headline: "Stop wasting money.",
    subheadline:
      "Paste any bill, renewal email, or contract. Watchtower finds what you're overpaying — in under a minute.",
    cta: "Check yours free",
  },
  B: {
    badge: "Bill-forwarding analyst",
    headline: "Forward us your bills. We'll find what you're overpaying.",
    subheadline:
      "No accounts, no permissions. Upload a document and get a plain-language money risk report.",
    cta: "Upload a bill",
  },
  C: {
    badge: "AI money watchdog",
    headline: "AI that watches your subscriptions, bills, and contracts.",
    subheadline:
      "Quietly catches renewals, price increases, and refunds you're owed — before they cost you.",
    cta: "Scan a document",
  },
  D: {
    badge: "Contract & bill scanner",
    headline: "Upload any contract. We'll tell you what could cost you money.",
    subheadline:
      "Deadlines, auto-renewals, hidden price jumps — read in seconds, explained in plain language.",
    cta: "Scan yours free",
  },
};

export const SAMPLE_TEXT = `Your Adobe Creative Cloud plan renews on October 14 at $19.99/month. This is an increase from your introductory price of $14.99/month. To cancel before the renewal, reply to this email or cancel in your account settings by October 13.`;
