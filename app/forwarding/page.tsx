import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { parseSessionToken } from "@/lib/auth";
import { db } from "@/lib/db";
import { getActiveAddress } from "@/lib/forward-address";
import { decryptField } from "@/lib/crypto";
import { ForwardingView } from "@/components/forwarding";

export const dynamic = "force-dynamic";

export default async function ForwardingPage() {
  const cookieStore = await cookies();
  const session = cookieStore.get("wt_session")?.value ?? null;
  const userId = parseSessionToken(session);
  if (!userId) redirect("/?auth=required");

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  });
  if (!user) redirect("/?auth=required");

  const address = await getActiveAddress(userId);
  const received = address
    ? await db.inboundMessage.count({ where: { addressId: address.id } })
    : 0;

  return (
    <ForwardingView
      address={
        address
          ? {
              id: address.id,
              localPart: address.localPart,
              domain: address.domain,
              active: address.active,
              createdAt: address.createdAt.toISOString(),
            }
          : null
      }
      received={received}
    />
  );
}
