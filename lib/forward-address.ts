// WT-12: per-user forwarding addresses (`u-<token>@in.watchtower.salmaan.dev`).
//
// Each user gets one active forwarding address; the local part is an
// unguessable random token. The address is the auth boundary for inbound
// mail (WT-11): a message is only ingested for the user who owns the address
// it was delivered to. Addresses are not encrypted at rest — the local part
// is a token with no PII; the `InboundMessage` contents stay encrypted (WT-8).
//
// Lifecycle:
//   provision()  — create a user's first active address (idempotent)
//   getActive()  — the current active address, if any
//   rotate()     — disable the current address, issue a new one
//   disable()    — permanently stop accepting inbound mail (no new address)

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";

export const INBOUND_DOMAIN = "in.watchtower.salmaan.dev";
export const INBOUND_ADDR_PREFIX = "u-";
const TOKEN_BYTES = 16; // 32 hex chars ≈ 128 bits of entropy

/** Generate a fresh random local-part token. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

/** Build the full address for a local part. */
export function fullAddress(localPart: string): string {
  return `${localPart}@${INBOUND_DOMAIN}`;
}

/** The user's active forwarding address, or null. */
export async function getActiveAddress(userId: string) {
  return db.inboundAddress.findFirst({
    where: { userId, active: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Provision the user's forwarding address. Idempotent: returns the existing
 * active address when one is already provisioned. Collision-safe: retries
 * with a fresh token when the generated local part somehow exists already.
 */
export async function provisionAddress(userId: string) {
  const existing = await getActiveAddress(userId);
  if (existing) return { address: existing, created: false };

  for (let attempt = 0; attempt < 3; attempt++) {
    const token = generateToken();
    const localPart = `${INBOUND_ADDR_PREFIX}${token}`;
    const exists = await db.inboundAddress.findUnique({ where: { localPart } });
    if (exists) continue;
    const address = await db.inboundAddress.create({
      data: { userId, localPart, domain: INBOUND_DOMAIN, token },
    });
    return { address, created: true };
  }
  throw new Error("Could not provision a unique forwarding address");
}

/**
 * Rotate: disable the current address and provision a fresh one. The old
 * address stops accepting mail immediately; already-ingested items are kept.
 */
export async function rotateAddress(userId: string) {
  const current = await getActiveAddress(userId);
  if (current) {
    await db.inboundAddress.update({
      where: { id: current.id },
      data: { active: false, disabledAt: new Date() },
    });
  }
  return provisionAddress(userId);
}

/** Permanently disable inbound forwarding for a user. */
export async function disableAddress(userId: string) {
  const current = await getActiveAddress(userId);
  if (!current) return null;
  return db.inboundAddress.update({
    where: { id: current.id },
    data: { active: false, disabledAt: new Date() },
  });
}
