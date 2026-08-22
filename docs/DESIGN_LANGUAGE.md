# Design Language — Watchtower

Version 1 (proposed, 2026-08-21). Implementable across the whole platform: landing, analyzer, watchlist, notifications, and future product surfaces.

---

## 1. Design principles

1. **Calm authority.** We watch over money and deadlines. The UI must feel like a trustworthy guardian: quiet, confident, never alarmist, never carnival.
2. **Proof over claims.** Every number is traceable to a source. The UI surfaces evidence as the primary trust mechanism — not badges or AI branding.
3. **One finding, perfectly.** The MVP renders one clear result, not a dashboard. Density is added only when monitoring earns it.
4. **Reduced motion, high contrast.** Accessibility is a feature: WCAG 2.1 AA minimum, comfortable for low-vision and low-attention users.
5. **Financial-grade typography.** Numbers are the hero. They must be set with tabular figures, never wobble, and never be decorative.
6. **Human, not hype.** Copy is plain language. No "powered by AI" everywhere; no anthropomorphized agent marketing in-product.

---

## 2. Brand narrative (one paragraph)

Watchtower is the quiet guardian of your money and deadlines. It reads what you don't want to read, notices what you'd miss, and tells you — in plain language — what could cost you, why, and what to do about it. The brand voice is that of a meticulous, slightly dry friend who happens to be excellent at paperwork: precise, calm, and always on your side.

---

## 3. Color system

### Core palette

| Token | Hex | Usage |
|---|---|---|
| `--wt-ink-900` | `#0F172A` | Primary text, headings |
| `--wt-ink-700` | `#334155` | Secondary text |
| `--wt-ink-500` | `#64748B` | Tertiary text, captions |
| `--wt-ink-300` | `#CBD5E1` | Borders, dividers, disabled |
| `--wt-paper-50` | `#F8FAFC` | Page background |
| `--wt-paper-0` | `#FFFFFF` | Cards, surfaces |
| `--wt-guardian-600` | `#0F766E` | Primary brand color (teal) — trust, calm authority |
| `--wt-guardian-700` | `#0D5F59` | Hover / active |
| `--wt-guardian-100` | `#CCFBF1` | Soft fills, badges |

### Semantic colors (money/risk language)

| Token | Hex | Usage |
|---|---|---|
| `--wt-save-600` | `#15803D` | Money protected / recovered, positive findings |
| `--wt-save-100` | `#DCFCE7` | Soft green fills |
| `--wt-warn-600` | `#B45309` | Renewal risk, upcoming deadlines, medium exposure |
| `--wt-warn-100` | `#FEF3C7` | Soft amber fills |
| `--wt-alert-600` | `#B91C1C` | Action required, high exposure, errors |
| `--wt-alert-100` | `#FEE2E2` | Soft red fills |
| `--wt-neutral-500` | `#64748B` | "No risk found" / informational |

Rules:
- **Color never carries meaning alone** — always paired with text or icon (accessibility + color-blind safety).
- Green = *protected/recovered*, amber = *watch*, red = *act now*. This mapping is consistent across product, email, and dashboards.
- The guardian teal is the only "brand" color; everything else is semantic.

### Dark mode
- Dark surfaces use the same hues at adjusted lightness (ink-900 becomes paper-0 background, etc.). Both modes are first-class from day 1 (CSS variables, `prefers-color-scheme` + manual toggle in app).

---

## 4. Typography

- **Headings / UI:** Inter (variable) — neutral, modern, excellent at small sizes.
- **Numbers:** the same Inter, but *always* with `font-variant-numeric: tabular-nums` (or a dedicated mono for raw extracted values). Numbers are the product.
- **Monospace (evidence panel):** JetBrains Mono or IBM Plex Mono for source quotes and file metadata — signals "this is the raw record."
- Scale (rem-based, fluid):
  - Display: `clamp(2rem, 5vw, 3.5rem)` — landing hero
  - H1: `2rem`, H2: `1.5rem`, H3: `1.25rem`, Body: `1rem`, Small: `0.875rem`, Caption: `0.75rem`
- Line height: 1.5 body, 1.2 headings. Letter spacing: normal; -0.01em on display.
- Copy rules:
  - Write in plain language (7th–8th grade reading level target for findings).
  - Numbers formatted with commas and cents only when they are money values; exposure always shown as a range or with explicit assumption.
  - Never say "AI". Say what was found: "We found a renewal date…".

---

## 5. Layout & grid

- **Landing:** centered single-column; hero input is the page. Max width 640px for the input card; 1200px for content sections.
- **App:** left sidebar nav (Watchlist / Documents / Account) + main content column (max 960px). Sidebar collapses to bottom-tab on mobile.
- **Result card:** single card per finding. Structure:

```
[Category badge] [verification tier chip]       [confidence chip]
Title (what this is)
"why it matters" paragraph (2 sentences)
──
Exposure block:   $108/yr potential      (assumption text under)
Deadline block:   Renews Oct 14 · cancel by Oct 13
Recommended action: [Primary button] [Secondary: copy message]
──
Evidence panel (collapsible, default open):
  "your plan will renew at $9.99 per month"  ← from page 2, line 3
```

- 8px spacing scale: `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`.
- Border radius: 8px cards, 12px hero card, 6px inputs; pills (999px) for badges.

---

## 6. Components (first set, implementable as a token-driven library)

1. **BrandMark** — watchtower icon: a simple beacon/eye glyph in guardian teal, monochrome. No gradients in MVP.
2. **InputZone** — the hero paste/upload area: large dashed-border dropzone, "Paste text" and "Upload PDF/screenshot" tabs, "Try an example" link. State: idle / processing (animated progress with stage names) / result / error.
3. **ResultCard** — as above; includes ExposureBlock, DeadlineBlock, ActionBlock, EvidencePanel.
4. **EvidencePanel** — monospace source quotes with "from page X" references; each fact row has a "wrong?" correction affordance.
5. **ConfidenceChip** — `certain` (solid), `conditional` (outline), `hypothetical` (dashed). Never a bare percentage in UI; percentage lives in the evidence tooltip.
6. **WatchButton** — the single conversion CTA. "Watch this for me" (primary). After account creation: "Watching" state with checkmark.
7. **WatchlistItem** — card with: kind badge, counterparty, deadline, exposure, status dot (green/amber/red), "check now" affordance.
8. **StatusDot / StatusChip** — for watchlist lifecycle: open / upcoming / due / resolved / dismissed.
9. **Toast system** — for "saved", "corrected", "watching" confirmations; quiet, top-right, auto-dismiss.
10. **EmptyState** — the watchlist-empty moment: "Nothing watched yet — upload your first bill."
11. **Button hierarchy** — Primary (guardian-600, white text), Secondary (outline), Ghost, Danger (alert-600) reserved for destructive/irreversible actions.

### Motion
- Max 150–250ms transitions; only transform/opacity.
- Processing state: subtle indeterminate progress + stage labels ("Reading document…", "Checking renewal terms…"). No skeletons bouncing; no celebratory confetti for a result (calm authority).
- One allowed delight: the "money protected" number counting up on the watchlist dashboard (Phase 2+).

---

## 7. Voice & tone

- **Do:** direct, plain, specific. "Your Adobe subscription renews Oct 14 at $19.99 — 33% more than the introductory price."
- **Don't:** "Unlock the power of AI-driven financial intelligence." Ever.
- **Uncertainty is spoken:** "We think this may renew automatically — the email says 'may renew'. We've marked it as a watch item, not an alert."
- **Numbers before adjectives:** show $, dates, and the assumption before any judgment words.
- **Empathy without pity:** "This is a common one — 1 in 3 renewal emails like this quietly bills people." (Never fabricated statistics; only real ones.)

---

## 8. Email & notification design

- Plain-text-first with a single HTML card fallback. Emails must read correctly in plain text (many bill-weary users block HTML).
- Email layout: brandmark, one finding per email (title + exposure + deadline + action link), footer with "stop watching this" and privacy note.
- Color usage in email: same semantic green/amber/red; never rely on color alone (text labels included).
- Notification copy template: "Renewal in 7 days: Adobe (Oct 14) — $19.99/mo. Cancel by Oct 13 or reply 'watch' to snooze."

---

## 9. Implementation notes (how to ship this)

**Status: implemented (WT-7, 2026-08-23).**

- **Token layer:** `styles/tokens.css` (CSS custom properties, light + dark via `prefers-color-scheme`), imported by `app/globals.css`. The typed source of truth is `lib/design-tokens.ts` (`LIGHT_TOKENS` / `DARK_TOKENS`, `SemanticTone`, confidence-tier variants); a parity unit test (`lib/design-tokens.test.ts`) fails the build if the CSS drifts. No hard-coded hex in components.
- **Typography:** Inter (sans) + JetBrains Mono (mono) loaded via `next/font` in `app/layout.tsx`; wired through Tailwind's `--font-sans`/`--font-mono`. All money values use the `.money` class (tabular figures).
- **Component library:** `components/ui/` — `BrandMark`, `Button` (`primary` / `secondary` / `ghost` / `danger` + `success` added by usage, plus `buttonClasses()` for links), `Badge` (semantic tones × solid/outline/dashed), `StatusChip`/`StatusDot` (watchlist lifecycle → green/amber/red with text labels), `Card`, `EmptyState`. Landing, analyzer result, watch CTA, waitlist, watchlist page, and confirmation screen are all built on these primitives.
- **Not yet built:** Toast system (§6.9 — deferred until there's a caller; grow via usage, not theory).
- **Figma/design tool:** none; the CSS token file IS the source of truth in MVP.
- **Audit gate:** every screen shipped is checked against: WCAG AA contrast, tabular numbers on all money, color+label pairing, no ungrounded claims, calm motion.

---

## 10. Open design questions

- Does the brand evolve into a "guardian" character (illustrated) at scale, or stay purely abstract/iconic? (Defer; needed only for marketing assets.)
- Dark mode default for the analyzer page? (Proposed: follow system; app: manual toggle.)
- Should the "money protected" number be shareable as a social card? (Phase 2+; design now to make it privacy-safe.)
