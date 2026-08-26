# MVP Roadmap

> Detailed Phase 0/1 execution plan, architecture, metrics, and risks: `docs/PHASE0_1_PLAN.md`. This file is the high-level roadmap.

## Phase 0 — Validate before building deeply
Goal: confirm that strangers understand the value proposition and will submit real inputs.

Build/test:
- Landing page
- Multiple positioning variants
- Upload/paste interaction prototype
- Waitlist / early access
- Manual or semi-manual analysis for first users

Learn:
- What people actually submit
- Which pains occur most often
- Which message gets the highest activation intent
- What users are willing to connect/share

## Phase 1 — Anonymous analyzer
Core flow:
1. Paste text or upload PDF/image/screenshot
2. Identify document/email type
3. Extract company/provider
4. Extract amounts
5. Extract dates
6. Detect recurring price/renewal/cancellation terms
7. Identify potential cost/deadline risk
8. Recommend action
9. CTA: “Watch this for me”

Must-have outputs:
- What matters
- Potential exposure
- Relevant deadline
- Recommended action
- Confidence / source evidence

## Phase 2 — Recurring product (in progress, 2026-08-23; Linear WT-10..WT-15)
> Note: the roadmap's original "Phase 2 = Accounts + Watchlist" was **already shipped** in Phase 1 (WT-5). Phase 2 as now scoped is the *recurring-product* phase: email-forwarding ingestion (WT-11/12), money-protected ledger (WT-13), deadline reminders (WT-14), acquisition experiments (WT-15).

Add persistence:
- Authentication ✅ (WT-5)
- Saved items ✅ (WT-5)
- Watchlist dashboard ✅ (WT-5)
- Status / deadlines / exposure ✅ (WT-5)
- Notes/history ✅ (WT-5)
- **NEW:** email forwarding ingestion — inbound infra ✅ (WT-11: MX→Resend→webhook, anti-abuse, reputation), per-account addresses ✅ (WT-12: provision/rotate/disable + settings UI + auto-ingestion)
- **NEW:** exposure/money-protected ledger ✅ (WT-13: strict categories + traceable dollars + `/ledger` dashboard + auto-record on resolve)
- **NEW:** deadline reminder sweep (T-7 / T-1) ✅ (WT-14: lifecycle `open → upcoming → due`, per-cadence dedupe, renewal reminders)
- **NEW:** acquisition experiments ✅ (WT-15: 2 SEO tools at `/tools/*` — contract renewal analyzer + cancellation deadline checker — repeat "Check another document free" hook, `ExperimentEvent` funnel instrumentation + admin table; content/Reddit ops pending)

**Status (2026-08-25):** WT-11 shipped (commit `48de397`) + verified live 2026-08-25 — public webhook endpoints answer correctly (`e2e-inbound.sh` all PASS), messages land as `InboundMessage` rows (quarantined `unknown_address` until an address exists). **WT-12 shipped** (commit `6473984`): per-account forwarding addresses (`u-<token>@in.watchtower.salmaan.dev`) with provision/rotate/disable, settings UI at `/forwarding`, linked from the watchlist; a forwarded message now auto-ingests through the WT-3 pipeline into a watch item (provenance `source=forward`, anti-abuse gates + dedupe apply). Next up: WT-13 (exposure/money-protected ledger).

**Status (2026-08-26):** WT-13, WT-14 shipped (commits `eb5ff67`, `9d6c64c`). **WT-15 shipped**: two free vertical SEO tools (`/tools/contract-renewal-analyzer`, `/tools/cancellation-deadline-checker`) as thin wrappers over the analyzer with preseeded examples, the "Check another document free" repeat hook after every result, and `ExperimentEvent` funnel instrumentation (`tool_view → analysis_start → result → account_created`, joined by the anonymous `wt_session_id` cookie, `wt_experiment` source cookie for content CTAs) surfaced in an admin Experiments table. Phase 2 code complete — remaining acquisition work is operational (short-form content + Reddit posts), not engineering.

## Phase 3 — Email forwarding
Give each account a unique forwarding address.

Use cases:
- Bills
- Receipts
- Renewal notices
- Cancellation confirmations
- Bookings
- Refund messages

This is lower trust-friction than full mailbox access.

## Phase 4 — Notifications
Add proactive value through:
- Email notifications
- Later: push
- Optional SMS/WhatsApp depending on cost and compliance

Alert categories:
- Action required
- Upcoming deadline
- Price increase
- Refund unresolved
- Renewal risk
- Opportunity found

## Phase 5 — Gmail / Outlook monitoring
Allow users to opt into selected categories.

Examples:
- Subscription renewals
- Price increases
- Bills
- Refunds
- Travel
- Receipts

Architecture:
Ingestion -> Classification -> Extraction -> Deduplication -> Risk/Event detection -> Watchlist update -> Notification

## Phase 6 — Obligation / Life Graph
Create durable structured state.

Core entities:
- Users
- Companies
- Accounts
- Subscriptions
- Contracts
- Purchases
- Assets
- Documents
- Deadlines
- Payments
- Obligations

Core relationships:
- purchased_from
- renews_on
- expires_on
- cancelled_on
- warranty_expires_on
- billed_by
- requires_notice_by

## Phase 7 — Agent actions
Start with low-risk execution.

Low risk:
- Draft email
- Request information
- Follow up
- Schedule reminder

Medium risk with approval:
- Submit refund request
- Negotiate renewal
- Initiate cancellation

High risk with explicit confirmation:
- Financial transaction
- Contractual commitment
- Government filing
- Major purchase

## Phase 8 — Outcome verification
Track real-world outcomes after action.

Examples:
- Refund actually received
- Subscription actually stopped billing
- Renewal price actually changed
- Claim actually approved

## Phase 9 — Savings / Protection dashboard
North-star dashboard:
- Money protected
- Money recovered
- Costs avoided
- Problems caught
- Tasks handled

## Phase 10 — Referrals and sharing
Enable privacy-safe share cards based on outcomes such as:
- Money saved
- Problems caught

## Phase 11 — Mobile
Build when mobile adds clear recurring value through:
- Push notifications
- Action approvals
- Fast uploads/photos
- Household engagement

## Phase 12 — Household
Add:
- Multi-member accounts
- Shared assets
- Household obligations
- Shared document vault

## Phase 13 — Banking/financial integrations
Only once trust and product-market fit justify the permission burden.

## Phase 14 — Business / Enterprise
Add:
- Organizations
- Workspaces
- Roles
- Approval policies
- Audit logs
- SSO
- API
- Admin reporting
- Data controls
