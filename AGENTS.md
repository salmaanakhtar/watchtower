<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md

## Project
Watchtower is an agentic SaaS platform that protects users from quietly losing money, missing important deadlines, and failing to act on administrative obligations.

## Repositories & issue tracking
- **GitHub**: https://github.com/salmaanakhtar/watchtower (branch `main` is the trunk; commit directly to `main`, no feature branches).
- **Linear**: Workspace `salmaanakhtar`, team `Watchtower` (key `WT`), project `Phase 0/1 — Validate & Ship`.
  - Linear is the source of truth for planning and issue tracking. It should be used *alongside* the docs to keep the project organized.
  - Labels: `phase-0`, `phase-1`, `infrastructure`, `design-language`, `security-privacy`, `growth`, `blocker`, `decision-needed`, `ai-agent`, `extraction`, `ingestion`, `watchlist`, `notifications`, `p0`/`p1`/`p2`.
  - Workflow states: Backlog -> Todo -> In Progress -> In Review -> Done (Canceled / Duplicate also available).
  - Templates: Feature, Bug, Phase 0 — Experiment, Phase 1 — Analyzer, Decision.
  - Linear MCP server is configured globally in `~/.config/opencode/opencode.jsonc` — **remote** server at `https://mcp.linear.app/mcp` (Streamable HTTP) authenticated with `Authorization: Bearer <LINEAR_API_KEY>`. It is NOT an npm package (there is no `@linear/mcp-server`). See https://linear.app/docs/mcp.
  - When working on a task, reference the Linear issue identifier (e.g. `WT-4`) in commit messages where applicable.

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

## Decision hygiene
When a meaningful strategic decision is accepted:
- Update the relevant document.
- Append a dated entry to `docs/DECISIONS.md` with decision, rationale, and revisit trigger.
- Move the corresponding Linear issue to `In Review` or `Done` and link the doc/commit.

## Development hygiene
- Keep MVP scope narrow.
- Separate ingestion, extraction, reasoning, event detection, action, verification, and notification layers.
- Instrument every agent decision with source input, extracted facts, confidence, recommendation/action, user correction, and outcome.
- Prefer reversible actions and approval gates for medium/high-risk actions.

## Testing (required before every push to main)
- **Definition of done: `npm test` (Vitest: unit + components + API routes) AND `npm run test:e2e` (Playwright) must both pass.**
- Full workflow documented in `docs/TESTING.md`.
- New feature = new tests: unit-test deterministic logic, integration-test API contracts, add an e2e for user-visible flows.
- E2E runs against a production build (`next start`), not dev mode (Next 16 dev on Windows intermittently 403s JS chunks).

## Growth hygiene
- Every product feature should be evaluated for its acquisition, activation, retention, referral, and monetization contribution.
