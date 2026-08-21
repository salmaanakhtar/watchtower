// Admin auth for Phase 0 — simple shared-secret bearer token.
// Replace with real auth (Auth.js, magic link) in Phase 1.

export function adminAuthorized(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}
