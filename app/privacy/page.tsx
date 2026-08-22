import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy notice — Watchtower",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-bold text-(--wt-ink-900)">Privacy notice</h1>
      <p className="mt-2 text-sm text-(--wt-ink-500)">Last updated: 2026-08-22 (WT-8)</p>

      <section className="mt-8 space-y-4 text-sm leading-relaxed text-(--wt-ink-700)">
        <div>
          <h2 className="text-base font-semibold text-(--wt-ink-900)">What we process</h2>
          <p className="mt-1">
            When you paste or upload a document, we read it to find obligations, amounts, and
            deadlines so we can show you risks and recommendations. We only process documents you
            explicitly give us.
          </p>
        </div>
        <div>
          <h2 className="text-base font-semibold text-(--wt-ink-900)">What we store</h2>
          <p className="mt-1">
            The document text and your account email are stored encrypted at rest (AES-256-GCM).
            Document text is kept only as long as needed to power your watchlist. Unreviewed
            anonymous uploads and submissions without your consent are deleted automatically.
          </p>
        </div>
        <div>
          <h2 className="text-base font-semibold text-(--wt-ink-900)">Retention</h2>
          <p className="mt-1">
            Analyses are kept for up to 90 days unless they are part of an active watch item.
            Watched items are kept while you watch them, plus a grace period. You can stop
            watching any item with one click from any reminder email.
          </p>
        </div>
        <div>
          <h2 className="text-base font-semibold text-(--wt-ink-900)">What we don&apos;t do</h2>
          <p className="mt-1">
            We never sell your data. We don&apos;t send marketing email — only transactional messages
            about things you&apos;re watching. No raw credit card numbers are ever stored.
          </p>
        </div>
        <div>
          <h2 className="text-base font-semibold text-(--wt-ink-900)">Questions</h2>
          <p className="mt-1">
            Contact us at privacy@watchtower.salmaan.dev with any privacy questions or deletion
            requests.
          </p>
        </div>
      </section>
    </main>
  );
}
