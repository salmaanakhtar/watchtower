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
- **NEW:** email forwarding ingestion — inbound infra ✅ (WT-11: MX→Resend→webhook, anti-abuse, reputation), per-account addresses ⏳ (WT-12)
- **NEW:** exposure/money-protected ledger ⏳ (WT-13)
- **NEW:** deadline reminder sweep (T-7 / T-1) ⏳ (WT-14)
- **NEW:** acquisition experiments ⏳ (WT-15, runs in parallel)

**Status (2026-08-23):** WT-11 shipped (commit `48de397`, In Review — needs DNS/Resend dashboard + env steps before public mail; see `docs/DEPLOYMENT.md` §WT-11). Next up: WT-12 (per-account forwarding addresses + settings UI + auto-ingestion).

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
