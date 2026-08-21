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
