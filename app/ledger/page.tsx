import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { parseSessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { decryptField } from "@/lib/crypto";
import { getLedgerSummary } from "@/lib/ledger";
import { LedgerView } from "@/components/ledger";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("wt_session")?.value ?? null;
  const userId = parseSessionToken(session);
  if (!userId) redirect("/?auth=required");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) redirect("/?auth=required");
  const displayEmail = decryptField(user.email);

  const ledger = await getLedgerSummary(userId);

  return <LedgerView user={{ email: displayEmail ?? "" }} ledger={ledger} />;
}
