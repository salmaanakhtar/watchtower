# Decisions Log

## 2026-08-21 — Start with a narrow money-protection wedge
**Decision:** Launch Watchtower around the promise “Stop losing money without realizing it” rather than launching immediately as a broad life-admin platform.

**Why:** The narrow promise is easier to understand, easier to market, and offers measurable ROI.

**Revisit when:** Users show strong pull for non-financial obligations and retention is proven.

---

## 2026-08-21 — Web-first MVP
**Decision:** Initial product should be web-first rather than requiring mobile app installation.

**Why:** Installation adds friction before value. The first-use experience should be faster than doing the task manually.

**Revisit when:** Push notifications, approvals, camera input, or recurring use clearly justify a mobile app.

---

## 2026-08-21 — Progressive permissions
**Decision:** Do not ask for full mailbox or financial access during initial onboarding.

**Why:** Trust and permission burden may exceed perceived value before the user experiences a useful result.

**Preferred sequence:** Anonymous upload -> account -> watchlist -> forwarding -> notifications -> mailbox integrations -> additional integrations.

---

## 2026-08-21 — Email forwarding before full inbox monitoring
**Decision:** Build user-specific forwarding addresses before full Gmail/Outlook monitoring.

**Why:** Forwarding is intuitive, useful, and has lower trust friction.

---

## 2026-08-21 — Agent execution comes after reliable detection
**Decision:** Do not prioritize full autonomous execution in the earliest MVP.

**Why:** Reliable detection, structured state, and trust are prerequisites for safe and useful action.

---

## 2026-08-21 — Verify outcomes
**Decision:** The long-term agent loop must include outcome verification, not only action initiation.

**Why:** The product should deliver real outcomes rather than claiming tasks are complete when they are not.

---

## 2026-08-21 — Project infrastructure: Linear + GitHub
**Decision:** Use Linear (workspace `salmaanakhtar`, team `Watchtower`/WT, project `Phase 0/1 — Validate & Ship`) as the planning/issue-tracking source of truth alongside the docs; use GitHub (`salmaanakhtar/watchtower`) for code with `main` as the only branch (commit directly to `main`).

**Why:** Centralized, auditable planning plus trivial push-to-ship for a solo founder; direct-to-main keeps iteration speed high and avoids branch overhead before the project earns it.

**Revisit when:** A second collaborator or a release train requires branches/reviews.

---

## 2026-08-21 — Linear automations & recurring issues are UI-only
**Decision:** Automations (workflow rules) and recurring issues are not exposed via the Linear GraphQL API. The team/state/labels/templates/seed issues were created via API; automations + a weekly recurring "planning" issue must be configured in the Linear UI.

**Why:** Linear's API surface does not include automation or recurrence creation.

**Revisit when:** Linear exposes these via API, or when the team grows enough to justify full automation.

---

## 2026-08-21 — Phase 1 MVP = "Anonymous Analyzer"
**Decision:** The MVP is a single-flow anonymous analyzer: paste/upload -> classify -> extract -> detect risk -> exposure + recommendation -> "Watch this for me" (account + watchlist). One finding rendered perfectly; minimal persistence (watchlist + deadline) is included in Phase 1 because it is required to convert a one-shot tool into a recurring product.

**Why:** Time-to-first-value < time-to-DIY requires a sub-60-second result with no account friction; but the product dies if there is no reason to return (the "Saturday-afternoon test").

**Revisit when:** Phase 1 exit criteria are met (precision ≥ 90%, watch conversion ≥ 25%).

---

## 2026-08-21 — Deterministic-first pipeline (LLM = extractor, not agent)
**Decision:** The Phase 1 pipeline separates layers strictly: deterministic (file handling, text extraction, normalization, alert gating, scheduling) vs LLM (classification, structured extraction, explanations) vs agentic (deferred entirely). LLM output is schema-validated, gated by confidence + verification tier, and never reaches the user ungated.

**Why:** Trust requires that money/deadline claims be reproducible and auditable; LLM reasoning alone cannot guarantee that. The moat is durable structured state + provenance, not model cleverness.

**Revisit when:** Agent actions are introduced (Phase 7 of MVP_ROADMAP) with approval gates.

---

## 2026-08-21 — Design language: "Calm authority"
**Decision:** Adopt the design language defined in `docs/DESIGN_LANGUAGE.md`: calm, proof-over-claims, financial-grade typography (tabular numbers), semantic color (green=protected, amber=watch, red=act), plain-language copy, WCAG AA.

**Why:** The product's trust promise ("guardian of your money") must be reflected in every surface; alarmist or hype-heavy design would contradict the brand.

**Revisit when:** Marketing scale requires a richer visual identity (illustrated guardian character, social cards).

---

## 2026-08-22 — WT-2 scope: deterministic analyzer, no LLM, no raw file bytes
**Decision:** WT-2 ships as a deterministic-only pipeline. The existing regex analysis engine is extended with provenance offsets, an exposure range (low/high, cents, with an explicit assumption statement) and the full risk-kind taxonomy. Uploads are base64-encoded client-side, validated server-side with magic-byte MIME detection; text-ish files are decoded and analyzed immediately, PDFs/images are *queued* with an honest "manual review" message instead of a fake result. No LLM, no object storage of raw bytes, no file contents persisted (only extracted text + hash for dedupe/retention).

**Why:** Precision ≥ 90% is the Phase 1 gate; the deterministic engine already meets the MVP bar for pasted text and text files, and every claim stays traceable to a quote. Faking analysis of PDFs/images would destroy the trust the product is built on; honest queuing (WT-9 manual loop) is the safer bridge. Storing no raw bytes keeps the PII surface minimal before WT-8 hardening.

**Revisit when:** WT-3 (ingestion/extraction) lands — swap the queued path for real PDF/OCR extraction, keep the same response contract.

---
**Decision:** Watchtower runs on the Hermes-managed VPS at `watchtower.salmaan.dev` (tailnet-private) instead of Vercel. Deployments are automated via Hermes (polls GitHub `main` every ~5 min, builds, health-checks, rolls back). The user owns deployments; agents only monitor, diagnose, and set env values via `hermes-deploy.py secret ...` (see `docs/DEPLOYMENT.md`).

**Why:** Full-stack control (Node worker, Prisma migrations, persistent SQLite volume), the VPS infra already exists for other projects, and the tailnet-private hostname keeps Phase 0 traffic contained.

**Revisit when:** Public internet launch requires DNS/public visibility, horizontal scaling, or managed Postgres (then revisit the SQLite choice).

## 2026-08-22 — WT-4: Canonical obligation/event schema v1 shipped
**Decision:** Adopted the canonical schema from PHASE0_1_PLAN.md §5.3 as real relational tables (User, Company, Document, Obligation, ProvenanceFact, WatchItem, Deadline, Payment, Event). Every analysis now persists a Document row + Obligation row (kind, counterparty, amount in cents + currency, risk type, exposure low/high, verification tier certain|conditional|hypothetical, confidence) + ProvenanceFact rows (label, value, verbatim quote, char offsets). The legacy Submission.result JSON stays for backward compat and is deprecated. API responses now carry an obligation object; the UI renders evidence from canonical facts.

**Why:** The moat is durable, watchable, verifiable obligations with provenance — not one-off summaries. Relational rows (not a JSON blob) make the alert gate, watchlist, dedupe, and corrections possible. Money is stored as integer cents; verification + confidence gate alerts deterministically.

**Revisit when:** WT-3 lands (extraction pipeline) — swap the deterministic mapper's human dates for ISO dates and per-field confidence; WT-5 adds User linkage to real accounts.

---

## 2026-08-22 — WT-5: Magic-link accounts + watchlist shipped
**Decision:** Accounts are passwordless magic-link only (HMAC-signed tokens via Node `crypto`, no third-party auth server, no passwords stored). Flow: "Watch this for me" on a result → email capture → magic link → session cookie (`wt_session`, 30 days, HttpOnly/SameSite=Lax) → obligation auto-linked to the account → watchlist. `WatchItem` gained a `(userId, obligationId)` unique constraint + `userNote`. Anonymous intent is remembered via a `wt_pending_obligation` cookie so the post-sign-in redirect lands back on the analysis (`/watch?obligation=…`). Emails are not actually sent yet: dev mode returns the link in the API response; real delivery lands in WT-6.

**Why:** The "Saturday-afternoon test" — a one-shot analyzer dies without a reason to return. A watchlist with deadlines is the minimal persistence that converts analysis into a recurring product (DECISIONS 2026-08-21 "Phase 1 MVP").

**Revisit when:** WT-6 ships real email delivery (swap dev link for transactional mail), and WT-8 hardens session storage (rotate AUTH_SECRET, add rate limiting on /api/auth/request).

---

## 2026-08-22 � WT-6: Transactional email (Resend) + deadline notifications shipped
**Decision:** Email delivery via Resend (`RESEND_API_KEY` + `EMAIL_FROM` envs; plain-text-first with a single HTML card, DESIGN_LANGUAGE �8). Magic-link emails now send for real in production; dev keeps the token-in-response path (and an e2e-only in-memory stub under `NOTIFY_STUB_SENDER=1`). A startup + hourly in-process sweep (`instrumentation.ts` ? `lib/sweep-scheduler.ts` ? `lib/notify-sweep.ts`, manually triggerable at `GET /api/notify/sweep`) selects watch items due within 7/3/1 days and sends one email per item per deadline, deduped via the `notifiedAt`/`Event(type=notified)` guard inside a transaction (idempotent under concurrent sweeps). Only `verification=certain` + `confidence >= 0.9` items alert (PHASE0_1_PLAN �5.4). Emails carry a one-click signed unwatch link (`GET /api/unwatch/[token]`, HMAC like the magic-link tokens, 1-year TTL) that dismisses the item + logs an Event. Until WT-3 ships ISO dates, deadlines are parsed from the legacy human labels ("October 14", anchored to the next occurrence) via `parseDeadline`.

**Why:** Real email was the #1 prerequisite for the watchlist to exist (production sign-in was blocked). Resend is a single HTTP call, no SMTP; the sweep is idempotent and process-local so it works on the single-instance VPS without a job queue; the alert gate keeps emails transactional and honest.

**Revisit when:** WT-3 lands (replace deadline-label parsing with `Obligation.dueDate`/ISO dates), WT-8 hardens the auth request rate limiter (currently a simple 1/min event check), or multi-instance hosting needs a durable job lock.

---

## 2026-08-23 — WT-3: Deterministic extraction + env-gated LLM structured extraction shipped
**Decision:** Ship the WT-3 extraction pipeline as deterministic-first with an optional LLM complement. Deterministic (always on): PDF text-layer extraction via `pdfjs-dist` legacy build, image OCR via `tesseract.js`, `.eml` RFC822 parsing (quoted-printable/base64), plus a shared ISO date primitive (`lib/dates.ts`). PDFs/images/.eml that yield readable text are now analyzed instead of queued; unreadable files keep the honest manual-review fallback (same response contract). LLM (env-gated): an OpenAI-compatible chat-completions client (`lib/llm-extract.ts`, `LLM_API_KEY`/`LLM_BASE_URL`/`LLM_MODEL`) that runs temperature 0, validates output against a zod schema (retry once), and maps ISO dates + per-field confidence into canonical obligations. The deterministic engine still gates what reaches the user; the LLM only enriches durable structured state. No LLM key = fully deterministic path (unchanged behavior).

**Why:** Real PDF/OCR extraction is the single biggest gap between the queued Phase 0 path and a usable analyzer; the docs call for deterministic-first (§5.5) with the LLM as a schema-validated extractor, not an agent. Env-gating keeps cost at $0 until a key is configured and guarantees the pipeline never breaks when the model fails.

**Revisit when:** A provider/key is configured and cost/analysis is measured against the <$0.10 budget (§8); scanned (image-only) PDFs need page-render → OCR chaining; vision models replace tesseract for screenshots.

---

## 2026-08-22 — WT-8: Security & privacy hardening shipped
**Decision:** Ship the Phase 1 hardening baseline: AES-256-GCM field encryption at rest (`FIELD_ENCRYPTION_KEY`, envelope `v1.iv.tag.ct`, tolerant of legacy plaintext on decrypt) for emails + document text; deterministic HMAC lookup hashes for emails (`User.emailHash` unique) so encrypted fields stay searchable; consent required before storing any analysis (`Submission.consent/consentAt`); per-email magic-link rate limiting (1/min + 5/hr, hash-keyed — fixes the old global-cooldown bug); daily retention sweep (delete unconsented/stale queued, anonymize old unreferenced, never touch watched items); append-only `AuditLog`; `Secure` cookies behind https; security headers; lazy Prisma client.

**Why:** Documents are high-sensitivity PII (financial, contracts); encryption at rest + retention + consent are the GDPR/CCPA/PIPEDA baseline the plan calls for (§10), and the trust promise requires "never stored permanently" to be true in code, not just copy. Field-level (not whole-DB) encryption keeps lookups/dedupe via hashes, and the envelope format makes key rotation a config change rather than a migration.

**Revisit when:** Object storage lands (S3/R2) — encrypt objects with the same key and move `rawBytes`/`dataUrl` out of SQLite; multi-instance hosting needs a durable (cross-process) rate limiter + retention lock; LLM providers are used (then log/redact LLM calls, per §10).

---

## 2026-08-23 � WT-11: Inbound email infra shipped (Resend Inbound + MX webhook)
**Decision:** Ship inbound email via Resend Inbound on subdomain in.watchtower.salmaan.dev � MX (lowest priority on the subdomain only, never the root), SPF (Resend's include), DMARC `p=quarantine` (not reject, while user forwards are being learned), plus a Svix-signed `email.received` webhook (`/api/inbound/webhook`) that fetches full content via the Received Emails API and runs it through the shared WT-3/4 ingestion pipeline (Document source `forward` + obligation + watch item). Anti-abuse: 50 msgs/address/day cap, 10MB total cap, unknown/disabled addresses quarantined (never bounced), unsubscribe subjects/bodies quarantined, content-hash dedupe. Reputation: bounce/complaint events (`/api/inbound/events`) stored in `ReputationEvent`; daily sweep alerts `REPUTATION_ALERT_EMAIL` when complaint rate > 2% or bounce > 5% over 7 days.

**Why:** Email forwarding is the highest-leverage recurring-ingestion mechanism (assumption A6); Resend Inbound is a single MX + webhook (no self-hosted MX to keep patched), and the subdomain keeps inbound MX completely separate from the sending domain so provider reputation is not coupled.

**Revisit when:** Phase 2 proves forwarding demand; then add per-account address generation UI (WT-12) and possibly DMARC `p=reject` once bounce/complaint rates are learned.

---

## 2026-08-25 — WT-12: Per-user forwarding addresses shipped (provision/rotate/disable + settings UI)
**Decision:** Each user gets one active `u-<token>@in.watchtower.salmaan.dev` address, provisioned idempotently on demand (`lib/forward-address.ts` + `POST/GET /api/forwarding`), managed from a `/forwarding` settings page (create/copy/rotate/disable) linked from the watchlist. The local part is a 128-bit random token with no PII (not encrypted at rest); the address IS the auth boundary — `processInboundWebhook` (WT-11) resolves the recipient address to its owner and auto-ingests through the WT-3 pipeline into a watch item (source `forward`), with anti-abuse gates and content-hash dedupe. Rotate disables the old address immediately and issues a fresh one; disable stops inbound entirely. Verified live 2026-08-25: `e2e-inbound.sh` all PASS on the VPS, messages land as `InboundMessage` rows (quarantined `unknown_address` before any address exists).

**Why:** WT-11's pipeline was fully built but had no way to create addresses — every real message was quarantined `unknown_address`. Provisioning per-user addresses (rather than one shared address) keeps ownership unambiguous, and rotate/disable give users control + an abuse escape hatch.

**Revisit when:** Inbound mail is proven at volume — consider limiting total addresses per user, rate capping provisioning, or moving to per-company addresses (Phase 3) if dedupe/ownership needs change.

---

## 2026-08-25 — WT-13: Money-protected ledger shipped (strict categories, traceable dollars)
**Decision:** Ship the money-protected ledger — the north-star value metric — as `LedgerEntry` rows with three strict categories: `prevented` (projected cost avoided by acting before a charge/deadline; a counterfactual, labeled a projection and never counted as recovered), `recovered` (realized refund/credit/corrected charge — always user- or pipeline-supplied, never derived from the obligation), `avoided` (a price increase/incorrect charge stopped on the current bill). Every entry links to its obligation (and through it, the source document + provenance), so each claimed dollar is traceable to a verified event. API: `GET/POST /api/ledger` (same auth as the watchlist; ownership via the obligation's `userId` OR a watch item). UI: `/ledger` page (total + per-category breakdown with definitions) and a "Money protected: $X" link in the watchlist header. Resolving a watch item auto-records a `prevented` entry from the obligation's conservative low exposure (idempotent via a `(userId, obligationId, category)` unique index). Migration `20260824221313_wt13_ledger`.

**Why:** "Money protected" is the metric that makes value visible (PRODUCT_BRIEF north-star), and §8/§10 require claims to be defensible — a projection must never masquerade as recovered money. Anchoring each dollar to an obligation keeps the ledger auditable before any aggregate marketing claim. Auto-recording on resolve turns a natural user action (marking an obligation done) into the ledger, so the metric fills without a separate data-entry burden.

**Revisit when:** Phase 8 outcome-verification loops can confirm recovered amounts post-action; or when aggregate "saved $X" marketing claims go out — then add an admin-verified flag and a public attestation view.

---

## 2026-08-25 � WT-14: Deadline reminder lifecycle shipped (T-7/T-1 cadence, open ? upcoming ? due)

**Decision:** Replace the WT-6 7/3/1-day sweep with a lifecycle-driven reminder sweep. Notify window is now T-7 and T-1 days before a deadline (configurable via NOTIFY_WINDOW_DAYS, comma-separated, strictest cadence wins). Dedupe is per-cadence: WatchItem.lastNotifiedCadence records the days-before of the last send, so a missed T-7 sweep still allows T-1 (restart-safe, unlike the old notifiedAt-only guard). Effective deadline order: WatchItem.deadline ? nearest future NoticeDeadline ? Obligation.dueDate ? legacy label ? (recurring-only) Obligation.renewalDate for "next renewal in X days" when no hard deadline exists. The dead WT-4 Deadline table was renamed to NoticeDeadline (the model the sweep actually reads; multi-deadline contracts). Lifecycle: creating a watch item derives its initial status from the deadline (open/upcoming/due); sending the T-7 reminder advances open ? upcoming; T-1 (or passing the deadline unreported) advances ? due; resolve/dismiss stop reminders permanently. Recipient email is resolved from the watch item's user (obligations from the anonymous analyzer have no userId, so obligation.user was always null and no reminder could ever send). Migration 20260825194500_wt14_reminder_lifecycle. Verified: 246 unit + 19 e2e green; e2e proves a watch item created 5 days out gets exactly one T-7 reminder and advances to upcoming, and a second sweep does not re-send.

**Why:** WT-6 shipped the transport but the schedule was a fixed window with a lossy dedupe and no status semantics � reminders couldn't reflect the lifecycle (open/upcoming/due), a missed sweep suppressed later reminders, and renewal-only obligations were never emailed. The status machine gives the watchlist + notifications a shared truth (DESIGN_LANGUAGE �6.7/6.8).

**Revisit when:** T-1/task-first reminders need to vary by risk type or user preference (per-item cadence overrides); multi-deadline obligations need per-deadline reminder tracking (the current guard is per-item, per-cadence); or when the sweep moves off-process (cron) and needs a distributed lock.
