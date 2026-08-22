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
- ~~Which document/email types should be supported first?~~ **Answered (Phase 1, WT-3):** PDF (text layer), images (OCR via tesseract.js), `.eml` (RFC822 + HTML fallback), pasted text. Remaining: which categories need the most accuracy investment (Phase 2 precision audit).
- ~~Which categories can be extracted reliably enough for launch?~~ **Answered (Phase 1):** subscriptions, price increases, trials, cancellations — deterministic rules + env-gated LLM structured extraction.
- ~~What should be deterministic vs LLM-driven?~~ **Answered (Phase 1):** deterministic = file handling, normalization, alert gating, scheduling, classification rules; LLM = structured extraction into the canonical schema, env-gated (see `docs/PHASE0_1_PLAN.md` §5.5).

## Phase 2 (recurring product)
- Which inbound email provider (Resend Inbound vs self-hosted MX) gives the best deliverability + abuse controls at Phase 2 scale?
- What is the right DMARC policy for the forwarding domain (p=quarantine vs reject) while user forwards are still being learned?
- How should the money-protected ledger handle counterfactual "prevented" dollars without overclaiming (precise attribution rules)?
- Do users actually forward bills, or is the friction too high (email-forwarding assumption A6 needs real-world validation)?
- What is the correct reminder cadence (T-7/T-1) without becoming spammy?

## Agent actions
- Which low-risk actions can be safely automated first?
- Which medium-risk actions have enough value to justify approval flows?
- Which actions create regulatory or platform-policy complications?

## Technical
- What should be the canonical event/obligation schema?
- How should evidence and provenance be stored?
- How should confidence thresholds affect alerts/actions?
- ~~What data should be encrypted separately or isolated?~~ **Answered (WT-8, 2026-08-22):** PII strings (emails, document text, queued raw bytes, result/analysis payloads) are encrypted at rest with AES-256-GCM (`FIELD_ENCRYPTION_KEY`); lookups use deterministic HMAC hashes (`User.emailHash`). Remaining question: how to handle encrypted object storage (S3/R2) once `rawBytes`/`dataUrl` move out of SQLite.
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
