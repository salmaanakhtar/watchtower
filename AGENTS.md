# AGENTS.md

## Project
Watchtower is an agentic SaaS platform that protects users from quietly losing money, missing important deadlines, and failing to act on administrative obligations.

## Source of truth
Before proposing substantial product, engineering, growth, or pricing changes, read:
- `docs/PRODUCT_BRIEF.md`
- `docs/PRODUCT_PRINCIPLES.md`
- `docs/TARGET_AUDIENCE.md`
- `docs/MVP_ROADMAP.md`
- `docs/MARKETING_DISTRIBUTION.md`
- `docs/PRICING_MONETIZATION.md`
- `docs/DECISIONS.md`
- `docs/OPEN_QUESTIONS.md`

## Operating principles
1. Build a painkiller, not a vitamin.
2. Time-to-first-value must be shorter than doing the task manually.
3. Prefer progressive onboarding: value first, permissions second.
4. Web-first for MVP; mobile comes after recurring monitoring/notifications justify installation.
5. Avoid overbuilding the “Personal Agent OS” before validating the money-saving wedge.
6. Agent workflow should evolve toward: Detect -> Understand -> Decide -> Act -> Verify -> Escalate.
7. Trust, auditability, reversibility, and explicit user approval are required for consequential actions.
8. Do not treat chat as the product. The durable product is persistent monitoring, structured state, permissions, workflow execution, and verified outcomes.
9. Consumer, household, SMB, and enterprise should share the same underlying product architecture; enterprise differentiation should come from plans, governance, permissions, integrations, and admin features rather than bespoke code forks.

## Decision hygiene
When a meaningful strategic decision is accepted:
- Update the relevant document.
- Append a dated entry to `docs/DECISIONS.md` with decision, rationale, and revisit trigger.

## Development hygiene
- Keep MVP scope narrow.
- Separate ingestion, extraction, reasoning, event detection, action, verification, and notification layers.
- Instrument every agent decision with source input, extracted facts, confidence, recommendation/action, user correction, and outcome.
- Prefer reversible actions and approval gates for medium/high-risk actions.

## Growth hygiene
- Every product feature should be evaluated for its acquisition, activation, retention, referral, and monetization contribution.
- Build free entry tools around specific pains where possible.
- Optimize the path: anonymous value -> account -> watchlist -> permission -> monitoring -> action.
