// Magic-link auth for WT-5 (accounts + watchlist). No passwords, no third-party
// auth server: short-lived HMAC-signed magic-link tokens + longer-lived session
// cookies, both built on Node's crypto (no extra deps). Pattern follows
// lib/admin.ts: secrets come from env, dev fallbacks keep local DX simple.

import { createHmac, timingSafeEqual } from "node:crypto";

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SESSION_COOKIE = "wt_session";
export const MAGIC_LINK_COOKIE = "wt_magic"; // pending email for post-link redirect

function secretFor(kind: "auth" | "magic"): string {
  const envKey = kind === "auth" ? "AUTH_SECRET" : "AUTH_MAGIC_SECRET";
  const dev = kind === "auth" ? "dev-auth-secret-change-me" : "dev-magic-secret-change-me";
  return process.env[envKey] ?? dev;
}

export function sign(payload: string, kind: "auth" | "magic"): string {
  return createHmac("sha256", secretFor(kind)).update(payload).digest("base64url");
}

export function verify(payload: string, signature: string, kind: "auth" | "magic"): boolean {
  const expected = sign(payload, kind);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export function encodeToken(payload: unknown, kind: "auth" | "magic"): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, kind)}`;
}

export function decodeToken(
  token: string | undefined | null,
  kind: "auth" | "magic",
): Record<string, unknown> | null {
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  if (!verify(body, signature, kind)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (typeof parsed.exp !== "number" || parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Build a magic-link token for an email. */
export function createMagicToken(email: string): string {
  const now = Date.now();
  return encodeToken(
    { email, sub: "magic", exp: Math.floor((now + MAGIC_LINK_TTL_MS) / 1000) },
    "magic",
  );
}

/** Build a session token for a user id. */
export function createSessionToken(userId: string): string {
  const now = Date.now();
  return encodeToken(
    { userId, sub: "session", exp: Math.floor((now + SESSION_TTL_MS) / 1000) },
    "auth",
  );
}

/** Validate a magic-link token and return the email, or null. */
export function parseMagicToken(token: string): { email: string } | null {
  const parsed = decodeToken(token, "magic");
  if (!parsed || parsed.sub !== "magic") return null;
  const email = parsed.email;
  return typeof email === "string" && email.includes("@") ? { email } : null;
}

/** Validate a session token and return the user id, or null. */
export function parseSessionToken(token: string | undefined | null): string | null {
  const parsed = decodeToken(token, "auth");
  if (!parsed || parsed.sub !== "session") return null;
  const userId = parsed.userId;
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

/** Cookie string for the session token (HttpOnly, SameSite=Lax, 30 days, Secure on https). */
export function sessionCookieValue(token: string): string {
  const secure = isHttps() ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = isHttps() ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function isHttps(): boolean {
  const origin = process.env.APP_ORIGIN ?? "";
  return origin.startsWith("https://");
}
