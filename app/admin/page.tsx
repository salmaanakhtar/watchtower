import { db } from "@/lib/db";
import { adminAuthorized } from "@/lib/admin";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const h = await headers();
  const secret = process.env.ADMIN_SECRET;
  const authorized = secret
    ? adminAuthorized(new Request("http://local", { headers: h }))
    : false;

  if (!authorized) redirect("/?admin=denied");

  const [submissions, waitlist] = await Promise.all([
    db.submission.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    db.waitlist.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="text-2xl font-bold text-(--wt-ink-900)">Admin — Phase 0</h1>

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
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-(--wt-ink-900)">
                  Variant {s.variant} · {s.kind} · {s.status}
                </span>
                <span className="text-xs text-(--wt-ink-500)">
                  {s.createdAt.toLocaleString()}
                </span>
              </div>
              <p className="mt-2 line-clamp-3 text-xs text-(--wt-ink-700)">
                {s.content.slice(0, 300)}
              </p>
              {s.analysis && (
                <p className="mt-2 text-xs font-mono text-(--wt-ink-500)">{s.analysis}</p>
              )}
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
