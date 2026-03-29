# TODOS

## Monetization

**Priority:** P1 — implement after external user validation

- [ ] **Stripe integration** — subscription + billing (Free/Pro tiers)
  **Why:** No monetization without payment infrastructure.
  **Context:** Free tier: 5 holdings, 1 briefing/day. Pro: $9 AUD/month, unlimited holdings, daily briefing, 30-day history. See `to_do.md` for full competitor analysis and pricing rationale.

- [ ] **Usage tracking in Supabase** — briefings/day count, holdings count per user
  **Why:** Needed to enforce free tier limits before Stripe integration.
  **Context:** Add `briefing_count` and `holdings_count` to user profile or compute from existing `briefings` table.

- [ ] **Paywall enforcement in briefing API** — check tier before generating
  **Why:** Free users capped at 5 holdings and 1 briefing/day.
  **Depends on:** Stripe integration + usage tracking.

- [ ] **Upgrade prompt** — shown when free user hits limit
  **Why:** Conversion path from free to paid.
  **Context:** "You have 5 holdings — upgrade to Pro to add more."
  **Depends on:** Stripe integration + paywall enforcement.

## Infrastructure

**Priority:** P2

- [ ] **Fix cron briefing storage** — ~~cron called `res.json()` on streaming NDJSON~~
  **Status:** Fixed in this PR. Leaving here as reference until verified in production.

## Future Features

**Priority:** P3

- [ ] **Mobile PWA / push notifications** — morning briefing delivery before market open
- [ ] **Email delivery** — cron already runs, just needs SMTP integration
- [ ] **Portfolio performance tracking over time** — Sharesight's core feature
- [ ] **Multi-portfolio support** — personal vs SMSF
- [ ] **Watchlist** — stocks not yet owned but monitoring
- [ ] **LSE support** — extend `market` field in Holding type with `'LSE'`

## Completed

- [x] **Multi-market support (ASX + NASDAQ/NYSE)** — market field on every holding, market-aware prices/charts/briefing (2026-03-29)
- [x] **Inline portfolio editing** — click-to-edit ticker/exchange/units cells (2026-03-29)
- [x] **Unit tests** — 20 tests covering yahoo-symbol routing, validators, market coercion (2026-03-29)
- [x] **Competitor analysis + pricing model** — in `to_do.md` (2026-03-29)
