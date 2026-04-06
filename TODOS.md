# TODOS — Portfolio Briefing

> Synthesised from `TODOS.md` + `to_do.md` on 2026-03-30.
> `to_do.md` is now superseded by this file.

---

## Priority Ranking (Urgency × Impact ÷ Effort)

| Rank | Item | Score |
|------|------|-------|
| #1 | Post sample briefing to r/AusFinance | 10 |
| #2 | Email delivery (Resend/SendGrid) | 8 |
| #3 | Privacy policy + email opt-in | 7 |
| #4 | Full intelligence stack (TA + ASX feed + economic calendar) | 7 |
| #5 | Signal accuracy tracker | 6 |
| #6 | Sharper landing page | 5 |
| #7 | Stripe integration | 5 |
| #8 | 30-day briefing history | 4 |
| #9 | Usage tracking in Supabase | 4 |
| #10 | Paywall enforcement | 3 |
| #11 | Upgrade prompt | 3 |
| #12 | Mobile PWA | 2 |
| #13 | Multi-portfolio / Watchlist / LSE | 1 |

---

## P0 — Do Before Any New Feature

- [ ] **Post sample briefing to r/AusFinance** — distribution + signal quality stress test in one action
  **Why:** 350k members. "Does this BHP/CBA/NDQ briefing look accurate to you?" generates real users AND validates signal quality. The highest-leverage action available — zero dev required.
  **How:** Post a real briefing output (not a product announcement). Ask the community to challenge the signals specifically.
  **Effort:** 1–2 human hours, zero dev.

---

## P1 — Pre-Monetization (ship before Stripe)

- [x] **Full intelligence stack** — TA signals + ASX announcements + economic calendar
  **Completed:** 2026-03-30
  **What shipped:**
  - `lib/technical-indicators.ts` — RSI(14), MACD, 50DMA/200DMA computed server-side from Yahoo Finance OHLCV
  - `lib/asx-announcements.ts` — last 5 ASX company announcements per ASX ticker
  - `lib/economic-calendar.ts` — hardcoded RBA/FOMC/AU economic release dates (refresh quarterly)
  - Updated `app/api/briefing/route.ts` — 25-year fund manager synthesis persona, citations required, TA injected into per-ticker context
  - **Cost delta:** $0.07 → ~$0.08–0.09/briefing (TA is zero cost, calendar adds ~$0.001 via Haiku)
  - **Note:** Reddit/r/AusFinance sentiment was removed — violates Reddit Data API terms (no AI inference use). Replaced by Stocktwits (see P1 below).

- [x] **Signal accuracy tracker** — log each signal with timestamp + price; schema ready for benchmark accuracy computation
  **Completed:** 2026-03-30
  **What shipped:**
  - `supabase/migrations/002_signal_logs.sql` — `signal_logs` table (user_id, ticker, market, signal, confidence, price_at_signal)
  - Briefing route inserts signal_log rows on each new briefing generation (uses OHLCV current price)
  - UI shows "X signals tracked" counter in briefing header
  - **Accuracy computation** (benchmark-adjusted vs ASX 200 / S&P 500) is deferred until ≥20 signals exist — add as a follow-up to this item
  - Run migration: `supabase migration up` or apply `supabase/migrations/002_signal_logs.sql` manually

- [x] **Privacy policy + email opt-in consent**
  **Completed:** 2026-03-30
  **What shipped:**
  - `app/privacy/page.tsx` — full privacy policy covering data collection, third parties, retention, contact
  - Sign-in button now shows "By continuing you agree to our Privacy Policy" link
  - Footer link to `/privacy` on main page

- [x] **Sharper landing page** — richer value prop for unauthenticated visitors
  **Completed:** 2026-03-30
  **What shipped:**
  - Hero section (unauthenticated): "Stop spending 20 minutes on Reddit every morning."
  - Static sample BHP card showing what a real briefing looks like (quality signal, TA context, citation)
  - CTA: "Try free — sign in with Google, no credit card"
  - Layout metadata description updated

- [ ] **Stocktwits sentiment layer** — replace Reddit with Stocktwits public API (`api.stocktwits.com/api/2/streams/symbol/{ticker}.json`)
  **Why:** Reddit Data API prohibits AI inference use. Stocktwits is free, no auth required for public streams, and returns explicit Bullish/Bearish sentiment tags. Better US coverage for NASDAQ/NYSE holdings.
  **What to build:** `lib/stocktwits-sentiment.ts` — fetch last 30 messages per ticker, count Bullish/Bearish tags, return 1-line sentiment summary (e.g. "BHP: 12 bullish / 3 bearish (last 30 posts)"). Inject into briefing route alongside TA.
  **Effort:** ~15 mins CC+gstack | 2 hours human.

- [ ] **Email delivery** — send morning briefing to opted-in users via Resend
  **Why:** Daily habit requires the product to come to the user (inbox = phone). A subscription product with no delivery mechanism is just a website.
  **Context:** Cron moves to 07:00 AEST. Full design spec in `~/.gstack/projects/danang0901-portfolio-briefing-app/Daniel Ang-main-design-20260406-152705.md`. Approved HTML reference at `~/.gstack/projects/danang0901-portfolio-briefing-app/designs/email-template-20260406/email-final-approved.html`.
  **Key design decisions:**
  - Subject line format: `Portfolio brief — Mon 6 Apr | ADD: AAPL` (signal in subject)
  - Email structure: action strip FIRST, then executive summary, then stock cards
  - Cards sorted by signal priority: ADD/TRIM first, then HOLD, EXIT last
  - Signal labels in email: short codes (ADD/HOLD/TRIM/EXIT), not renamed labels
  - Light mode only. Inline CSS required. Min 15px body text. 44px CTA height.
  - Failure state: send "couldn't generate today" notice instead of silencing
  - Bounce handling: set `email_briefing_enabled = false` on hard bounce
  - Weekend: skip Sat/Sun (cron schedule `0 21 * * 0-4` UTC)
  **Pre-build checklist:** Domain ownership confirmed, SPF/DKIM live in Resend before first send.
  **Effort:** ~3–5 hours CC+gstack | 3–5 days human.

- [ ] **Email card sort by signal priority** — ADD/TRIM signals first in email, HOLD last
  **Why:** Doctor should see the one actionable card before the 7 HOLD cards. Action strip surfaces it, but card order reinforces priority.
  **Context:** Email-only behavior. Web app card order stays as-is (user controls portfolio order there). Sort logic: ADD > TRIM > HOLD > EXIT in email.
  **Effort:** ~5 mins CC+gstack | 30 mins human.
  **Depends on:** Email delivery implementation.

- [ ] **Landing page hero copy update** — replace generic hero with inbox-first framing
  **Why:** Current copy ("Stop manually researching every holding before market open") speaks to active research behavior, not inbox-first professional behavior.
  **What to change:** Hero headline and sub-headline only. Layout and sample card stay.
  - New headline: "Your portfolio briefing in your inbox before work."
  - New sub-headline: "What changed. What to watch. What (if anything) to act on."
  - New body: "AI-generated daily brief for your exact holdings — delivered to your inbox at 7am."
  **Effort:** ~5 mins CC+gstack | 30 mins human.

---

## P2 — Monetization

Implement after pre-monetization checklist (especially email + accuracy tracker) is complete and external users are validating the product.

### Tier Definition

| Tier | Price | Limits |
|------|-------|--------|
| Free | $0 | Up to 5 holdings, 1 briefing/day (cached), no history |
| Pro  | $9 AUD/month | Unlimited holdings, daily briefing, 30-day signal history, email delivery |

### Competitor Landscape

| Product | What it does | Pricing | What it lacks |
|---------|-------------|---------|---------------|
| **Sharesight** | Portfolio performance, CGT reports, dividend tracking | Free (10 holdings), $17–53 AUD/mo | No AI briefing, no actionable signals |
| **Simply Wall St** | Visual "snowflake" analysis per stock | Free (5), ~$15 USD/mo | Static analysis, not a daily briefing |
| **Stockopedia** | Stock screening with quality/value/momentum scores | ~$280–420 AUD/yr | Not portfolio-personalised, no narrative |
| **Morningstar** | Deep analyst reports, star ratings | ~$35 AUD/mo | Long-form, not a 2-minute daily check |
| **Market Index** | Free ASX data, watchlist, news | Free | No AI, no portfolio briefing |
| **Perplexity/ChatGPT** | Manual "what happened to BHP today" queries | $20/mo | Not portfolio-integrated, no daily habit |

**The gap nobody fills today:**
- AI-generated daily briefing tailored to *your specific holdings*
- Actionable signals (ADD/HOLD/TRIM/EXIT) with TA context and citations
- Works for mixed ASX + US portfolios
- Under $10/month

**Closest threat:** Sharesight or Simply Wall St adding an AI briefing feature.
**Moat:** (1) first-mover with ASX long-term holders, (2) daily briefing habit, (3) verified signal accuracy track record (build this now).

### Monetization Tasks

- [ ] **Stripe integration** — subscription + billing (Free/Pro tiers)
  **Why:** No monetization without payment infrastructure.
  **Effort:** ~30 mins CC+gstack | 2–3 days human.

- [ ] **Usage tracking in Supabase** — briefings/day count, holdings count per user
  **Why:** Needed to enforce free tier limits.
  **Context:** Add `briefing_count` and `holdings_count` to user profile or compute from `briefings` table.
  **Effort:** ~20 mins CC+gstack | 1 day human.

- [ ] **Paywall enforcement in briefing API** — check tier before generating
  **Why:** Free users capped at 5 holdings and 1 briefing/day.
  **Depends on:** Stripe + usage tracking.

- [ ] **Upgrade prompt** — shown when free user hits limit
  **Context:** "You have 5 holdings — upgrade to Pro to add more."
  **Depends on:** Paywall enforcement.

- [ ] **30-day briefing history with signal outcome overlay** — show past signals vs actual price moves
  **Why:** "March 1 — ADD on NDQ at $35.20. Today: $38.90 (+10.8%)" is in-app proof of value. Pro tier differentiator.
  **Depends on:** Signal accuracy tracker running for ≥30 days.
  **Effort:** ~25–30 mins CC+gstack | 3–5 days human.

---

## P3 — Future Features

- [ ] **Mobile PWA / push notifications** — home screen install + push at 09:30 AEST
  **When:** After email delivery is validating the daily habit for ≥20 users.
  **Effort:** ~2 hours CC+gstack | 2–3 weeks human.

- [ ] **Signal accuracy computation** — benchmark-adjusted accuracy score vs ASX 200 / S&P 500
  **When:** After signal_logs table has ≥20 signals (30+ days of usage).
  **Context:** Use `adjclose` prices (adjusted for dividends/splits). Display "ADD signals beat ASX 200 benchmark X% of the time over 90 days" on landing page.
  **Effort:** ~45 mins CC+gstack | 1 week human.

- [ ] **Portfolio performance tracking over time** — Sharesight's core feature

- [ ] **Multi-portfolio support** — personal vs SMSF

- [ ] **Watchlist** — stocks not yet owned but monitoring

- [ ] **LSE support** — extend `market` field with `'LSE'`

- [ ] **Annual billing** — ~$79 AUD/year (~30% discount). Add after monthly churn is measurable.

---

## Environment Variables Required

| Variable | Required | Purpose |
|----------|----------|---------|
| `ANTHROPIC_API_KEY` | Yes | AI briefing generation |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Auth + cloud sync |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Auth + cloud sync |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional (cron only) | Morning cron briefings |
| `CRON_SECRET` | Optional (cron only) | Cron auth |
| `STOCKTWITS_ACCESS_TOKEN` | Optional | Stocktwits sentiment layer (no auth needed for public API) |

---

## Completed

- [x] Multi-market support (ASX + NASDAQ/NYSE) — 2026-03-29
- [x] Inline portfolio editing — 2026-03-29
- [x] Unit tests (20 tests) — 2026-03-29
- [x] Competitor analysis + pricing model — 2026-03-29
- [x] Privacy policy + email opt-in — 2026-03-30
- [x] Full intelligence stack (TA + ASX feed + calendar) — 2026-03-30
- [x] Signal accuracy tracker (schema + logging) — 2026-03-30
- [x] Sharper landing page — 2026-03-30
