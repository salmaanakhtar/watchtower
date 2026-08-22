import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

// Lazy singleton: the client is built on first use so tests that set
// process.env.DATABASE_URL at module top get the right database regardless of
// import order or worker reuse.
let client: PrismaClient | null = null;

function createClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

export function getDb(): PrismaClient {
  if (!client) client = createClient();
  return client;
}

export const db = new Proxy({} as PrismaClient, {
  get(_t, prop, receiver) {
    const c = getDb();
    const value = Reflect.get(c, prop, receiver);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
