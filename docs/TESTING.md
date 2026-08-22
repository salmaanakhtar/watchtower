# Testing Workflow — Watchtower

Testing is part of the definition of done for every feature. Nothing ships (commits to `main`) with failing tests.

## Tooling

| Layer | Tool | Command |
|---|---|---|
| Unit + component | **Vitest** + Testing Library + jsdom | `npm test` (run once) / `npm run test:watch` |
| API route integration | Vitest against a throwaway SQLite DB (`prisma migrate deploy` in `beforeAll`) | covered by `npm test` |
| End-to-end (browser) | **Playwright** (Chromium) | `npm run test:e2e` |

All three must pass before pushing:
```sh
npm test
npm run test:e2e
```

## What each suite covers

- **`lib/*.test.ts`** — deterministic core logic: the analysis engine (`analyzeText`) classification rules, exposure math, variant hashing, copy integrity. The analysis rules are the risk-critical code; add a test for every new rule.
- **`lib/extraction.test.ts`** — WT-3 extraction: pdfjs-dist text extraction against a generated minimal PDF, `.eml` RFC822 parsing (multipart/quoted-printable/base64/HTML fallback), OCR via a mocked tesseract worker, and the file→method dispatcher.
- **`lib/llm-extract.test.ts`** — WT-3 LLM structured extraction: config gating, zod schema acceptance/rejection, mocked-provider happy path, prose-around-JSON tolerance, retry-on-invalid, provider-error/disabled null fallback, and `toCanonicalStructured` mapping (ISO dates, per-field confidence).
- **`components/*.test.tsx`** — component behavior with Testing Library: validation states, submit flow (mocked fetch), result rendering, evidence toggle. jsdom environment.
- **`app/api/routes.test.ts`** — API handlers against the real SQLite schema: happy path, invalid input, auth gating. Uses `DATABASE_URL=file:.test.db` (created and deleted per run).
- **`e2e/*.spec.ts`** — full browser flows against a production build (`next build` + `next start` on port 3100, via Playwright `webServer`): landing variants, paste → analysis → result → waitlist, upload, validation errors.

## Conventions

- **New feature = new tests.** Unit test the deterministic logic, integration-test the API contract, and add an e2e for the user-visible flow.
- **Data-testid** attributes (`data-testid="…"`) are the e2e selectors — keep them stable; they are part of the test contract.
- **Never test implementation details** — test behavior a user or API consumer can observe.
- **The analysis engine is deterministic by design** (see `docs/PHASE0_1_PLAN.md` §5.5). Tests assert exact classifications and exposure math. LLM output is schema-validated: `lib/llm-extract.test.ts` asserts the zod schema + mocked-provider behavior, never a live model call.

## Known issues / notes

- Playwright e2e runs against **production** (`next start`), not dev — Next 16 dev mode on Windows intermittently 403s on JS chunks (Turbopack HMR), which breaks client-side handlers in tests. If you must test against dev, expect flakiness; prefer `npm run test:e2e`.
- The e2e webserver reuses an existing server if port 3100 is already up (`reuseExistingServer`); rebuild (`npm run build`) after frontend changes so `next start` serves fresh code.
- Vitest route tests exec `npx prisma migrate deploy` against a temp DB — needs `prisma.config.ts` (already present).
