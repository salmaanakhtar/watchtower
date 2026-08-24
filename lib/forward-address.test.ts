// WT-12: unit tests for per-user forwarding addresses (provision/rotate/disable).

import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TEST_DB = path.join(__dirname, `.forward.test.${process.pid}.${Date.now()}.db`);
process.env.DATABASE_URL = `file:${TEST_DB}`;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

import { db } from "@/lib/db";
import {
  provisionAddress,
  rotateAddress,
  disableAddress,
  getActiveAddress,
  generateToken,
  fullAddress,
  INBOUND_ADDR_PREFIX,
} from "@/lib/forward-address";

beforeAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
  execSync(`node "${path.join(REPO_ROOT, "node_modules", "prisma", "build", "index.js")}" migrate deploy`, {
    env: { ...process.env, DATABASE_URL: `file:${TEST_DB}` },
    cwd: REPO_ROOT,
    stdio: "pipe",
  });
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      unlinkSync(`${TEST_DB}${suffix}`);
    } catch {}
  }
});

beforeEach(async () => {
  await db.inboundAddress.deleteMany();
  await db.user.deleteMany();
});

describe("token + address helpers", () => {
  it("generates unique unguessable tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
  });

  it("builds a full address with the prefix and domain", () => {
    expect(fullAddress("u-abc")).toBe("u-abc@in.watchtower.salmaan.dev");
  });
});

describe("provisionAddress", () => {
  it("creates a fresh address for a user", async () => {
    const user = await db.user.create({ data: { email: "e", emailHash: "h1", anonymous: false } });
    const { address, created } = await provisionAddress(user.id);
    expect(created).toBe(true);
    expect(address.active).toBe(true);
    expect(address.localPart.startsWith(INBOUND_ADDR_PREFIX)).toBe(true);
    expect(address.domain).toBe("in.watchtower.salmaan.dev");
    expect(address.userId).toBe(user.id);
  });

  it("is idempotent: returns the existing active address", async () => {
    const user = await db.user.create({ data: { email: "e", emailHash: "h2", anonymous: false } });
    const first = await provisionAddress(user.id);
    const second = await provisionAddress(user.id);
    expect(second.created).toBe(false);
    expect(second.address.id).toBe(first.address.id);
    const count = await db.inboundAddress.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it("gives different users different addresses", async () => {
    const u1 = await db.user.create({ data: { email: "a", emailHash: "h3", anonymous: false } });
    const u2 = await db.user.create({ data: { email: "b", emailHash: "h4", anonymous: false } });
    const [a1, a2] = await Promise.all([provisionAddress(u1.id), provisionAddress(u2.id)]);
    expect(a1.address.localPart).not.toBe(a2.address.localPart);
  });
});

describe("rotateAddress", () => {
  it("disables the old address and provisions a fresh one", async () => {
    const user = await db.user.create({ data: { email: "e", emailHash: "h5", anonymous: false } });
    const old = await provisionAddress(user.id);
    const { address: fresh } = await rotateAddress(user.id);

    expect(fresh.id).not.toBe(old.address.id);
    expect(fresh.active).toBe(true);

    const oldRow = await db.inboundAddress.findUnique({ where: { id: old.address.id } });
    expect(oldRow?.active).toBe(false);
    expect(oldRow?.disabledAt).not.toBeNull();

    const active = await getActiveAddress(user.id);
    expect(active?.id).toBe(fresh.id);
  });
});

describe("disableAddress", () => {
  it("disables the active address and leaves none active", async () => {
    const user = await db.user.create({ data: { email: "e", emailHash: "h6", anonymous: false } });
    await provisionAddress(user.id);
    const disabled = await disableAddress(user.id);
    expect(disabled?.active).toBe(false);

    expect(await getActiveAddress(user.id)).toBeNull();
  });

  it("is a no-op when no address exists", async () => {
    const user = await db.user.create({ data: { email: "e", emailHash: "h7", anonymous: false } });
    expect(await disableAddress(user.id)).toBeNull();
  });
});
