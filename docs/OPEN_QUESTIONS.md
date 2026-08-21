# Open Questions

## Product-market fit
- Which initial pain produces the highest activation: subscriptions, bills, contracts, refunds, warranties, insurance, or something else?
- Which use cases happen frequently enough to justify a recurring subscription?
- What is the strongest “random Tuesday” use case?

## Trust
- What information are users willing to upload anonymously?
- When will users trust Watchtower enough to connect email?
- What level of transparency is required before users approve agent actions?

## Distribution
- Which positioning message gets the highest upload/signup intent?
- Which content format produces the best organic acquisition?
- Which free vertical tools have the highest search demand and conversion potential?

## Pricing
- Is subscription-only enough, or should recovery-based pricing be part of the model?
- What is the best household pricing structure?
- How much measurable value must the product create before users will pay monthly?

## MVP scope
- Which document/email types should be supported first?
- Which categories can be extracted reliably enough for launch?
- What should be deterministic vs LLM-driven?

## Agent actions
- Which low-risk actions can be safely automated first?
- Which medium-risk actions have enough value to justify approval flows?
- Which actions create regulatory or platform-policy complications?

## Technical
- What should be the canonical event/obligation schema?
- How should evidence and provenance be stored?
- How should confidence thresholds affect alerts/actions?
- What data should be encrypted separately or isolated?
- **Proposed answers in `docs/PHASE0_1_PLAN.md` §5 — to confirm with the first 50 real documents.**
- Which document categories can the extraction pipeline handle reliably (PDF scans vs screenshots vs .eml)? — needs Phase 0 tech spike.
- Is a cheap/fast LLM sufficient for structured extraction at < $0.10/analysis, or does quality require a frontier model? — needs Phase 1 cost measurement.
- What is the correct alert-gate threshold (confidence × verification tier) that maximizes value without false alarms? — needs Phase 1 precision audit.

## Design language
- Should the brand evolve a "guardian" character/illustration at scale, or stay abstract? (deferred to marketing needs)
- Dark mode default for the analyzer page? (proposed: follow system)
- Should "money protected" become a shareable social card? (Phase 2+; design now for privacy-safety)

## Operations
- Configure Linear automations + weekly recurring issue in the UI (API does not support them).
- When should the linear team/project structure evolve (cycles, milestones)? (after Phase 1 exit criteria)

## Enterprise
- Which enterprise wedge best maps to the consumer engine: SaaS/vendor renewals, compliance deadlines, invoice errors, or contract obligations?
- When should organization/workspace primitives be introduced?
