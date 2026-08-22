# Phase 0 / Phase 1 — Execution Plan & Architecture

Status: **Proposed** (2026-08-21). Companion to `docs/MVP_ROADMAP.md`, `docs/PRODUCT_PRINCIPLES.md`, `docs/DECISIONS.md`.

---

## 1. Critical assessment of the product thesis

The core thesis is sound and appropriately narrow:

> Consumers quietly lose money through overlooked subscriptions, renewals, refunds, contracts, bills, and deadlines. An agent that watches their documents and obligations can find and stop that leakage.

Strengths of the current plan:
- The wedge is a **measurable, financially anchored pain** ("stop losing money") rather than vague "AI assistant" positioning.
- The value-first / permission-second onboarding sequence (anonymous upload -> account -> watchlist -> forwarding -> mailbox) is correct and well documented.
- The decision to avoid full mailbox/banking access up front is right; trust and perceived value are the binding constraints, not feature count.
- Persistent structured state (obligations, watchlist, verification) is the correct moat vs. one-off chatbot summaries.

Challenges that deserve explicit attention:

1. **The real moat is not the LLM — it is the deterministic obligation/event model + monitored state over time.** Any competitor can ship a PDF->summary tool with an LLM in a week. Watchtower only compounds if every analysis becomes a durable, watchable, verifiable obligation with deadlines and follow-up. Every Phase 1 decision should be evaluated against "does this make the next month of monitoring more valuable?"
2. **"Money protected" is a marketing claim, not an accounting identity.** The north-star metric requires discipline about what counts: prevented costs (projected, never realized), recovered money (realized), and avoided churn (counterfactual). We need an explicit, conservative definition of each category or the metric becomes meaningless and legally risky (see §10).
3. **The Saturday-afternoon test.** "Upload a bill and get an answer" is a delightful one-shot. The product dies if it cannot convert that spark into a recurring reason to return: a deadline that matters on Tuesday, a renewal that would have hit the card. Phase 1 must therefore include the absolute minimum persistence (save/watch + deadline) — otherwise we validate a demo, not a product.
4. **Category ambiguity is the top extraction risk.** A document that says "Your annual protection plan renews on 15 June" is unambiguous. One that says "We may renew your subscription automatically" is a *conditional obligation* with different risk math. The MVP must distinguish *certain*, *conditional*, and *hypothetical* obligations and reflect that in confidence and alerts, rather than overclaiming.
5. **Regulatory surface is real but manageable if we stay narrow.** Consumer notices, auto-renewal laws (e.g. FTC Negative Option Rule in the US, EU consumer directives), and "AI advice" claims can create liability. Staying in "analyze my document, explain the risk, recommend, let me act" territory keeps us in safe harbor relative to "we act on your behalf."
6. **Distribution is the unvalidated half.** The docs already say this, but the plan's riskiest assumption is not whether the analyzer works — it is whether strangers will upload their bills from a landing page at all. Phase 0 exists to answer exactly that, before any deep engineering.

---

## 2. Biggest assumptions to validate before deep development

| # | Assumption | Why it matters | Validation method | Kills / shapes what |
|---|---|---|---|---|
| A1 | Strangers will upload/paste real financial documents without an account | Distribution and unit economics depend on it | Phase 0 landing page + paste/upload prototype, organic traffic, no-account analysis | If false: pivot to email-forwarding-first or content-first funnel |
| A2 | The single most common submitted document has a clear, extractable money risk | Extraction accuracy bar is set by the top category | 30–50 manual analyses of Phase 0 uploads | Determines which 1–2 categories Phase 1 optimizes first |
| A3 | Users will create an account and save/watch at least one item | Recurring product depends on it | Save/watch CTA conversion rate on analyzed results | If <15%: rework value handoff, or build email-only workflow |
| A4 | A material fraction of findings are *actionable with high confidence* (≥90% precision on "certain" category) | False alarms destroy trust; the "detect only" value prop relies on precision | Human review of Phase 1 output vs. ground truth on a labeled corpus | If precision <90%: gate alerts to "certain" only, ship "reports" not "alerts" |
| A5 | Users understand what "potential exposure" means and trust the number | The core visual claim | 5–10 user interviews with the Phase 0 prototype + fake exposure numbers | Changes how we present ranges, sensitivity, and caveats |
| A6 | Email forwarding (Phase 3) will be the growth engine, not a gimmick | Long-term retention depends on ongoing ingestion | After Phase 2, cohort study: forwarding opt-in rate, documents/month forwarded | If forwarding is empty: invest in Gmail OAuth or manual import instead |

Phase 0 explicitly exists to test A1–A3 with a landing page + manual/semi-manual analysis, keeping engineering spend near zero. A4–A6 are Phase 1/2 tests.

---

## 3. Smallest realistic MVP (Phase 1 — "Anonymous Analyzer")

One page, one flow, no accounts required for the first result:

1. **Input:** paste text OR upload PDF / image (screenshot, photo) — no registration.
2. **Understand:** classify document type (subscription notice / bill / contract / receipt / refund notice / renewal notice / other).
3. **Identify:** extract the company/provider, amounts, dates, recurrence, cancellation terms, deadlines.
4. **Decide:** is there a meaningful monetary risk or opportunity? (price increase, auto-renewal, forgotten trial, refund owed, deadline passing, wrong charge.)
5. **Explain:** plain-language "why it matters," tied to the extracted facts (not generic boilerplate).
6. **Quantify:** potential exposure — a conservative range (low–high) with an explicit assumption statement, e.g. "$8.99/mo × 12 months = $108/year if not cancelled".
7. **Recommend:** one clear next action (cancel before date X / request refund / escalate to provider / nothing to do now).
8. **Save/Watch:** "Watch this for me" -> create account (email/password or magic link) -> item is persisted to a watchlist with deadline, exposure, status.

Definition of done for MVP:
- Time from file drop/paste to first meaningful result: **< 60 seconds** (target, per Product Principle #3).
- Precision on "actionable finding" ≥ 90% (human-verified against a 50-document labeled set).
- Every finding renders: what matters / exposure / deadline / recommendation / confidence with source evidence.
- The analysis pipeline is instrumented end-to-end (see §5 Observability) so every Phase 0/1 learning loop closes.

Deliberately excluded from the MVP (see §7).

---

## 4. First-user experience (time-to-first-value < time-to-DIY)

Landing page = the tool. No marketing page + separate app. One hero input.

```
┌──────────────────────────────────────────────────────────────┐
│  Watchtower                                                   │
│  Stop losing money without realizing it.                      │
│  ┌──────────────────────────────────────────────┐            │
│  │  Paste a bill, renewal email, or notice…     │            │
│  │  or  [Upload PDF / screenshot]  [Try example]│            │
│  └──────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
```

Flow:
- **0–5 s:** paste/upload. If a PDF/image, we extract text/OCR in the background while showing a progress state with the extracted text visible (transparency builds trust and corrects bad OCR before analysis).
- **5–20 s:** analysis runs; UI streams status: "Classifying document…", "Finding dates & amounts…", "Checking renewal risk…".
- **20–60 s:** result card. One finding, not a dashboard:
  - Title: "You're paying $8.99/mo that renews automatically on Oct 14."
  - Why it matters (2 sentences, grounded in the document).
  - Exposure: "$108/yr if this renews. Last increase: +$3/mo on Feb 1."
  - Recommended action: "Cancel before Oct 14 to avoid the next charge." + button "Copy cancellation message" (low-risk value).
  - Confidence + evidence: "What we read" panel listing extracted facts, each clickable to the source sentence/pixel region.
- **After the result:** one CTA — "Watch this for me" -> account creation -> watchlist item with deadline and exposure. That's the entire funnel.

Why this beats DIY: doing this manually means finding the email, opening the terms, computing the annual cost, and setting a reminder — 10–20 minutes of unpleasant work. The tool must deliver the answer in under a minute with the evidence to trust it.

**Key UX rule:** the result must be *verifiable at a glance*. Confidence is shown as evidence, not just a number: "High confidence — based on: renewal date found, price found, auto-renewal clause found." A user should be able to disagree with every extracted fact and correct it (corrections feed the watchlist and the training loop).

---

## 5. Technical architecture for the MVP

### 5.1 Stack summary (proposed — to be confirmed in Phase 0 spike)

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | Next.js (React) + Tailwind, deployed on Hermes-managed VPS (`watchtower.salmaan.dev`, tailnet-private) | Fast iterating, SSR for landing/SEO, one codebase for landing+app; auto-deploy from GitHub main (see `docs/DEPLOYMENT.md`) |
| Backend/API | TypeScript API (Next.js API routes or separate Fastify service) | Team velocity; one language across stack |
| Auth | Auth.js (email magic link first; Google OAuth later). No passwords in MVP | Lowest friction, aligns with "value first" |
| Database | Postgres (Supabase or Neon) + Prisma ORM | Relational obligation graph fits perfectly; cheap to start |
| Object storage | S3-compatible (Cloudflare R2) with per-user prefixes + encryption at rest | Documents are PII; R2 is cheap and has no egress fees |
| Ingestion | Upload endpoint + background worker (queue: Inngest/Trigger.dev or plain Postgres-backed queue) | Async pipeline keeps API fast |
| Extraction | PDF text (pdf-parse / Unstructured), images (OCR via Tesseract or a vision LLM), email `.eml`/`.msg` parsing | Deterministic first, LLM as complement |
| LLM/agent | Structured output extraction (JSON schema) from a frontier model with temperature ~0; no open-ended agent loop in MVP | Deterministic risk logic must gate LLM output |
| Orchestration | Single pipeline service with explicit stages; no autonomous agent loop yet | Keeps pipeline auditable and cheap |
| Observability | Structured JSON logs + OpenTelemetry traces + error tracking (Sentry) + LLM call logging | Every decision is instrumented; this is the moat's audit trail |
| Notifications | Email (Resend/Postmark) for MVP; push later | Matches Phase 4 roadmap |
| Security/privacy | See §10 | PII at rest, tenant isolation, retention policy from day 1 |

### 5.2 Pipeline stages (strictly separated)

```
Ingestion -> Extraction -> Classification -> Structuring -> Risk/Event detection -> Presentation
   (deterministic)     (deterministic+LLM)     (LLM)          (LLM)               (deterministic rules)      (render)
```

### 5.3 Structured obligation/event schema (v1, canonical)

The single most important engineering artifact. Every document becomes rows; every row is watchable.

```jsonc
// document
{
  "id": "uuid",
  "userId": "uuid | null (anonymous)",
  "source": "paste | upload | forward",
  "filename": "string",
  "contentType": "application/pdf",
  "storageKey": "s3://bucket/user/…",
  "extractedText": "string",          // deterministic
  "extractionMethod": "pdf-parse | ocr | raw",
  "createdAt": "datetime"
}

// obligation (the core entity — what the user watches)
{
  "id": "uuid",
  "documentId": "uuid",
  "kind": "subscription | contract | bill | refund | warranty | insurance | renewal | trial | other",
  "counterparty": { "name": "string", "normalized": "string" },
  "amount": { "cents": 899, "currency": "USD", "interval": "monthly" },
  "amountConfidence": 0.97,
  "startDate": "date?",
  "renewalDate": "date?",
  "noticeDeadlineDate": "date?",
  "expiryDate": "date?",
  "cancellationTerms": { "noticePeriodDays": 30, "autoRenews": true, "sourceQuote": "…" },
  "risk": {
    "type": "price_increase | auto_renewal | forgotten_trial | refund_due | deadline | incorrect_charge | none",
    "exposureLowCents": 10800,
    "exposureHighCents": 10800,
    "exposureAssumption": "9.99/mo for 12 months if not cancelled",
    "dueDate": "date?",
    "confidence": 0.92,
    "verification": "certain | conditional | hypothetical"
  },
  "provenance": [
    { "fact": "price", "quote": "your plan will renew at $9.99 per month", "offset": [120, 140] }
  ],
  "userDecision": { "status": "watched | ignored | resolved | disputed", "userNote": "…", "updatedAt": "datetime" },
  "createdAt": "datetime"
}

// watchlist item (user-facing persistence)
{
  "id": "uuid",
  "userId": "uuid",
  "obligationId": "uuid",
  "status": "open | upcoming | due | resolved | dismissed",
  "deadline": "date?",
  "nextCheckAt": "datetime",          // cron for re-check
  "notifiedAt": ["datetime"]
}
```

Key design rules:
- **Provenance is non-negotiable.** Every extracted fact carries the source quote and (for PDFs) page/region offsets. This is the audit trail that makes confidence explainable and corrections possible.
- **verification field** distinguishes *certain* (dates+prices both present), *conditional* (auto-renewal clause present), *hypothetical* (LLM inference). Alerts gate on this + confidence.
- **amount in cents + currency**, never floats. Locale formatting only at render.
- **One obligation can produce many watchlist items** (e.g. contract has renewal deadline + price increase + notice deadline).
- **Normalized counterparty** enables future dedupe ("Adobe" vs "Adobe Inc").

### 5.4 Confidence and provenance model

- Each field has `confidence ∈ [0,1]` from extraction.
- Risk findings carry a `verification` tier (certain/conditional/hypothetical) *and* confidence.
- **Alert gate (deterministic rule):** only `verification=certain` with `confidence ≥ 0.9` may generate an alert. `conditional` requires higher evidence or is surfaced as "watch item, no alert." `hypothetical` is presented as a question, never an alert.
- Corrections by the user downgrade/upgrade field confidence and feed a labeled corpus for evaluation.

### 5.5 Deterministic vs LLM vs agentic (explicit separation)

| Layer | Mechanic | Notes |
|---|---|---|
| **Deterministic** | File type detection (MIME/magic bytes), PDF text extraction, date/amount regex primitives, currency/cents normalization, alert gating by confidence+verification, cron scheduling, notification dispatch, dedupe of identical documents | All money/deadline display logic is deterministic; the same input always yields the same output |
| **LLM** | Document classification, structured extraction into the schema (with JSON schema validation + retry), plain-language explanation of "why it matters", recommendation text | Temperature ~0; output is validated against schema; never reaches the user un-gated |
| **Agentic (deferred)** | Draft cancellation/refund emails, follow-up actions, negotiation steps, outcome verification loops | Phase 7 per roadmap; approval gates required; NOT in MVP |

The MVP's LLM is a **high-reliability extractor**, not a reasoning agent. This is the single most important architectural discipline for trust.

### 5.6 Observability

- Structured JSON logs at every stage with `documentId`, `obligationId`, stage, latency.
- OpenTelemetry traces: upload -> extract -> classify -> structure -> detect -> render.
- LLM call log: prompt version, model, tokens, latency, validation pass/fail, raw+parsed output (with PII redaction policy).
- Error taxonomy per stage (extraction failure vs schema validation failure vs detection none).
- **Product analytics:** funnel events (visit -> analysis start -> result rendered -> correction made -> account created -> watch created), per-category conversion. This closes the Phase 0/1 learning loop.
- Weekly precision audit: sample N findings, human-label, compute precision/recall per category; gate on ≥90% precision.

---

## 6. Phases (tied to Linear project "Phase 0/1 — Validate & Ship")

### Phase 0 (weeks 1–3) — Validate before building
Deliverables:
1. Landing page with 2–4 positioning variants (A/B) + "Try the analyzer" paste/upload box.
2. Manual/semi-manual analysis pipeline behind the scenes (first ~30–50 uploads analyzed by hand; the *experience* is real, the automation is fake).
3. Waitlist / early access capture.
4. Positioning test plan per `MARKETING_DISTRIBUTION.md` (§"Pre-development validation").
5. Tech spike: confirm the stack (hosting, OCR quality on screenshots, PDF extraction quality, LLM schema compliance).

Exit criteria:
- ≥ 100 uploads from real strangers (no paid ads).
- ≥ 30% of visitors who start an analysis get a result (with manual backing).
- Top 3 document categories identified; each with ≥ 8 examples.
- ≥ 15% of analyzed users create an account or join waitlist.
- Qualitative signal: users correctly restate what Watchtower does after one use.

### Phase 1 (weeks 4–9) — Anonymous Analyzer MVP
Deliverables (Linear WT-2..WT-8):
- Full pipeline (WT-3, WT-4): ingestion, extraction, classification, structuring, risk detection, presentation with evidence panel.
- Result page with exposure + recommendation + "Watch this for me" (WT-2).
- Accounts + watchlist + deadline state (WT-5) — the minimal persistence to make it a product.
- Email notifications for watch items (WT-6) — only after the watchlist exists.
- Design system implementation (WT-7) — see `docs/DESIGN_LANGUAGE.md`.
- Security & privacy hardening baseline (WT-8) — encryption at rest, tenant isolation, retention, consent.
- Precision audit process running.

**Status:** WT-2 (anonymous analyzer MVP) shipped 2026-08-22 on the deterministic path. AnalysisResult carries provenance offsets + exposure low/high cents + assumption. Uploads: text-ish files analyzed immediately (client-side base64 → server decode with magic-byte MIME check); PDF/images queued for manual review (honest message, no fake results). No LLM yet, no raw file bytes stored. See `docs/DECISIONS.md` (2026-08-22 entry) and commit `WT-2`.

**Status (WT-4):** Canonical obligation/event schema v1 shipped 2026-08-22 (migration `20260822062503_wt4_canonical_schema`). Real tables: `User`, `Company`, `Document`, `Obligation`, `ProvenanceFact`, `WatchItem`, `Deadline`, `Payment`, `Event` (see `prisma/schema.prisma`). Every analysis now persists Document + Obligation (kind, counterparty, amount in integer cents + currency, risk type, exposure low/high + assumption, verification tier, confidence) + ProvenanceFact rows (label, value, verbatim quote, character offsets). The deterministic mapper lives in `lib/obligations.ts` (with unit tests). The legacy `Submission.result` JSON is retained for the Phase 0 queue and marked deprecated. API responses (`POST/GET /api/analyses`) carry an `obligation` object; the UI renders evidence from canonical facts. Dates remain human-readable strings from the deterministic engine until WT-3 ships ISO-date extraction.

Exit criteria:
- Time-to-result < 60 s median (p90 < 120 s).
- Precision ≥ 90% on actionable findings (human audit, n ≥ 50 per category).
- ≥ 25% of analyzed users watch at least one item.
- Pipeline fully instrumented; weekly audit cycle operational.

### Phase 2 (weeks 10–14) — Recurring product
- Email forwarding addresses (Phase 3 of MVP_ROADMAP compressed here, since it is the highest-leverage acquisition mechanism per assumption A6).
- Deadline reminders + "renewal approaching" notifications.
- Watchlist dashboard with exposure ledger ("Money protected so far" with strict definitions).
- First acquisition experiments (see §9) run to completion.

---

## 7. What NOT to build yet

1. **Autonomous agent actions** (drafting/refunding/cancelling). Roadmap Phase 7; approval gates first.
2. **Full Gmail/Outlook monitoring.** Roadmap Phase 5; only after forwarding is proven.
3. **Banking/card integrations.** Roadmap Phase 13. Permission burden far exceeds MVP value.
4. **Chat interface / conversational agent.** The product is not chat (Product Principle 8). MVP is a flow, not a chatbot.
5. **Mobile apps.** Roadmap Phase 11. Responsive web suffices until push notifications justify installation.
6. **Household/multi-member accounts, SMB/enterprise workspaces, RBAC, SSO.** After the wedge is validated.
7. **Shareable outcome cards / referral engine.** After watchlist retention is proven.
8. **Custom vertical tools** (warranty checker, airline compensation…). After the core analyzer works; each is a thin wrapper over the same pipeline.
9. **"Personal Agent OS" dashboards** (life graph, overview grids). The MVP renders ONE finding brilliantly, not an admin dashboard.
10. **Recommendation systems / cross-user patterns** ("other users saved with…"). Privacy and trust risk; premature.

---

## 8. Measurable success metrics

### Phase 0
- Uploads from strangers: **≥ 100** (organic only).
- Analysis start -> result completion: **≥ 30%** (manual-backed).
- Post-analysis account/waitlist creation: **≥ 15%**.
- Top-3 category identification: 3 categories × ≥ 8 samples.
- Positioning test: winning variant determined with ≥ 90% significance threshold on upload intent.

### Phase 1
- Median time-to-first-result: **< 60 s** (p90 < 120 s).
- Precision on actionable findings: **≥ 90%** (human audit, weekly).
- Analyze -> watch conversion: **≥ 25%**.
- Watch -> deadline-reached coverage: **≥ 80%** of watch items have a due date.
- Cost per analysis (LLM + infra): **< $0.10** at 1,000 analyses/day (unit economics sanity).
- Pipeline reliability: ≥ 99% of uploads complete pipeline (no silent failures).

### Phase 2 (monitoring)
- Notifications sent / delivered / acted-on (click-through) rates.
- Retention: ≥ 30% of accounts with a watch item return within 30 days.
- Money-protected ledger accuracy: 100% of claimed savings traceable to a verified obligation event.

---

## 9. First acquisition experiments (run in parallel with development)

1. **Short-form content ("this harmless email could cost you $480/year")** — TikTok/Reels/Shorts/X, driving to the landing tool. Measure: click->analysis start.
2. **Two free vertical SEO tools** built as thin wrappers over the same pipeline: "Contract renewal analyzer" and "Cancellation deadline checker." Measure: organic signups, tool->account conversion.
3. **Reddit/community posts** in personal-finance and subscription-fatigue communities, sharing anonymized findings (e.g. "I analyzed 20 random bills; 6 had auto-renewals people forgot"). Measure: traffic + upload intent. Careful: no doxxing, no real user data; use synthetic documents.
4. **Landing page A/B (the 4 positioning variants from MARKETING_DISTRIBUTION.md)** — measure upload intent per variant.
5. **Referral-of-a-finding**: after a user gets a result, offer "Check another document free" — the user re-uploads their second document, which gives us repeat-usage data AND a second chance at account conversion. (This is product-native, not a referral program.)

Each experiment must close the loop: traffic -> analysis -> result quality feedback -> account.

---

## 10. Legal, security, trust, platform-policy, and business risks to investigate before launch

### Legal / regulatory
- **Auto-renewal / negative option rules** (US FTC Negative Option Rule; EU Consumer Rights Directive; state laws like CA/IL). Our recommendations ("cancel before date X") must not accidentally encourage violating terms we misread. Legal review of recommendation wording needed.
- **No fiduciary/advice claims.** "Potential exposure" is a projection, not investment/financial advice. Standardize disclaimer + assumptions statement.
- **Advertising of money-saving claims** ("Watchtower saved users $1M") — substantiation and FTC endorsements rules apply. The money-protected ledger must be auditable before we publish aggregate claims.
- **Data protection:** GDPR (EU users), CCPA (CA users), PIPEDA (CA), UK GDPR. Documents are high-sensitivity PII (financial, contracts, personal IDs). Need DPA with subprocessors, lawful-basis mapping, deletion workflows, data residency option for enterprise later.
- **Consumer protection agencies** (e.g. what constitutes "refund assistance") — avoid anything that looks like debt-collection or unauthorized representation of the user.
- **Email forwarding domain reputation** — unique forwarding addresses can be flagged as spam/phishing by providers; need DMARC/DKIM/SPF hygiene and anti-abuse controls (rate limits, size caps, quarantine).

### Security
- **PII at rest:** full-disk + field-level encryption, key management (KMS), no raw card numbers ever stored.
- **Tenant isolation:** per-user document prefixes, per-user encryption context, authorization checks on every read; anonymous vs authenticated separation.
- **LLM data handling:** documents sent to LLM providers — contract terms (no training on data), regional routing, redaction policy; prompt-injection resistance (a bill could contain instructions aimed at the extraction model).
- **Upload abuse:** malware in PDFs (must sanitize/parse safely), size limits, file-type allowlist, rate limiting, quota per anonymous session (prevent mining).
- **Auth:** magic-link tokens short-lived, rotation, rate-limited; no password storage in MVP.

### Trust / product
- **False alarms** are the #1 trust killer. The alert gate (§5.4) exists to protect against this. Publish precision numbers transparently.
- **"Money protected" skepticism** — must be conservatively defined, per §1.2 and §8.

### Platform policy
- **App store / marketplace policies** if we ever advertise refund-claiming or cancellation assistance on social platforms (each platform has rules about financial services ads). TikTok/IG/Meta ad policy review before any paid spend.
- **Email provider ToS** for bulk/scheduled mail (never send unrequested mail; watchlist notifications are transactional, which is fine).

### Business risks
- **Unit economics of LLM-heavy analysis** — must monitor cost/analysis (§8). Caching + cheap models for re-extraction of duplicate documents.
- **One-shot novelty** — the Saturday-afternoon-test problem; the watchlist + notifications are the retention bet, and Phase 1's success gates include watch conversion for exactly this reason.
- **Competitor replication** — the durable-state moat (§1.1) must be built before anyone else copies the demo; speed matters, but precision matters more for trust.

---

## 11. Immediate next steps (this week)

1. Approve this plan; log the decision in `docs/DECISIONS.md`.
2. Begin Phase 0: scaffold landing page (Next.js + Tailwind) with the 4 positioning variants; wire the paste/upload box to a "we'll analyze manually for the first users" queue.
3. Start the tech spike (OCR quality on screenshots, PDF extraction, LLM schema compliance on 10 sample documents).
4. Set up Linear automations in the UI (not available via API): auto-close "In Review -> Done" on merge, triage rules, and the weekly recurring issue.
5. Launch the first content + community acquisition experiments (synthetic-document content only).
