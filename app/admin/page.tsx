import { db } from "@/lib/db";
import { adminAuthorized } from "@/lib/admin";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export const CATEGORIES = [
  "subscription",
  "bill",
  "contract",
  "receipt",
  "refund",
  "notice",
  "other",
] as const;

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function reviewAction(formData: FormData) {
  "use server";
  const id = formData.get("id");
  const category = formData.get("category");
  const analysis = formData.get("analysis");
  if (typeof id !== "string" || !id) return;
  const data: { category?: string; analysis?: string; status: string } = {
    status: "reviewed",
  };
  if (typeof category === "string" && category) data.category = category;
  if (typeof analysis === "string" && analysis.trim()) data.analysis = analysis.trim();
  await db.submission.update({ where: { id }, data });
}

export default async function AdminPage() {
  const h = await headers();
  const secret = process.env.ADMIN_SECRET;
  const authorized = secret
    ? adminAuthorized(new Request("http://local", { headers: h }))
    : false;

  if (!authorized) redirect("/?admin=denied");

  const [submissions, waitlist, summary] = await Promise.all([
    db.submission.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        variant: true,
        kind: true,
        contentType: true,
        filename: true,
        sizeBytes: true,
        status: true,
        category: true,
        analysis: true,
        createdAt: true,
        content: true,
        rawBytes: true,
        dataUrl: true,
      },
    }),
    db.waitlist.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.submission.groupBy({
      by: ["category"],
      _count: { _all: true },
      where: { category: { not: null } },
    }),
  ]);

  const total = submissions.length;
  const queued = submissions.filter((s) => s.status === "queued").length;
  const reviewed = submissions.filter((s) => s.status === "reviewed").length;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold text-(--wt-ink-900)">Admin — Phase 0</h1>

      <section className="mt-4 flex flex-wrap gap-3 text-sm">
        <span className="rounded-full border border-(--wt-ink-300) px-3 py-1 text-(--wt-ink-700)">
          {total} submissions
        </span>
        <span className="rounded-full border border-(--wt-warn-300) px-3 py-1 text-(--wt-warn-600)">
          {queued} queued
        </span>
        <span className="rounded-full border border-(--wt-save-300) px-3 py-1 text-(--wt-save-600)">
          {reviewed} reviewed
        </span>
        {summary.length > 0 && (
          <span className="rounded-full border border-(--wt-ink-300) px-3 py-1 text-(--wt-ink-700)">
            {summary.map((s) => `${s.category}:${s._count._all}`).join(" · ")}
          </span>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-(--wt-ink-700)">
          Submissions ({submissions.length})
        </h2>
        <ul className="mt-3 space-y-3">
          {submissions.length === 0 && (
            <li className="text-sm text-(--wt-ink-500)">No submissions yet.</li>
          )}
          {submissions.map((s) => (
            <li
              key={s.id}
              className="rounded-lg border border-(--wt-ink-300) bg-(--wt-paper-0) p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-(--wt-ink-900)">
                  Variant {s.variant} · {s.kind} · {s.status}
                </span>
                <span className="text-xs text-(--wt-ink-500)">
                  {s.createdAt.toLocaleString()}
                </span>
              </div>
              {s.filename && (
                <p className="mt-1 text-xs text-(--wt-ink-500)">
                  {s.filename} ({s.contentType} · {formatBytes(s.sizeBytes)})
                  {s.category ? ` · category: ${s.category}` : ""}
                </p>
              )}
              <p className="mt-2 line-clamp-3 text-xs text-(--wt-ink-700)">
                {s.content.slice(0, 300)}
              </p>
              {s.analysis && (
                <p className="mt-2 text-xs font-mono text-(--wt-ink-500)">{s.analysis}</p>
              )}

              {s.dataUrl && (
                <a
                  href={s.dataUrl}
                  download={s.filename ?? "attachment"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block rounded-md border border-(--wt-guardian-600) px-3 py-1.5 text-xs font-semibold text-(--wt-guardian-600) hover:bg-(--wt-guardian-600) hover:text-white"
                >
                  View attachment
                </a>
              )}

              <form action={reviewAction} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="id" value={s.id} />
                <label className="flex flex-col text-xs text-(--wt-ink-500)">
                  Category
                  <select
                    name="category"
                    defaultValue={s.category ?? ""}
                    className="mt-1 rounded-md border border-(--wt-ink-300) bg-(--wt-paper-50) px-2 py-1.5 text-sm text-(--wt-ink-900)"
                  >
                    <option value="">—</option>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-1 flex-col text-xs text-(--wt-ink-500)">
                  Analysis note
                  <textarea
                    name="analysis"
                    defaultValue={s.analysis ?? ""}
                    rows={2}
                    className="mt-1 rounded-md border border-(--wt-ink-300) bg-(--wt-paper-50) px-2 py-1.5 text-sm text-(--wt-ink-900)"
                    placeholder="What did you find? (optional)"
                  />
                </label>
                <button
                  type="submit"
                  className="rounded-md bg-(--wt-guardian-600) px-3 py-2 text-xs font-semibold text-white hover:bg-(--wt-guardian-700)"
                >
                  Save review
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-(--wt-ink-700)">
          Waitlist ({waitlist.length})
        </h2>
        <ul className="mt-3 space-y-2">
          {waitlist.length === 0 && (
            <li className="text-sm text-(--wt-ink-500)">No signups yet.</li>
          )}
          {waitlist.map((w) => (
            <li
              key={w.id}
              className="rounded-lg border border-(--wt-ink-300) bg-(--wt-paper-0) px-4 py-3 text-sm"
            >
              <span className="font-medium text-(--wt-ink-900)">{w.email}</span>
              <span className="ml-3 text-xs text-(--wt-ink-500)">
                via {w.source} · {w.createdAt.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
