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
