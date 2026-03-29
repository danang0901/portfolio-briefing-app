# Portfolio Briefing

**An AI-powered daily briefing for your stock portfolio.**

Portfolio Briefing reads your holdings and generates a personalised morning brief every day — with actionable ADD/HOLD/TRIM/EXIT signals, live news context, and portfolio-level insights. Works for ASX, NASDAQ, and NYSE stocks.

**Live app:** [portfolio-briefing-app.vercel.app](https://portfolio-briefing-app.vercel.app)

---

## What it does

- **Daily AI briefing** — One click generates a full briefing across all your holdings, each with a signal (ADD / HOLD / TRIM / EXIT), confidence rating, thesis status, catalyst summary, and upcoming events to watch.
- **Live news** — Searches Yahoo Finance for current news on each stock before generating.
- **Multi-market** — Supports ASX (`.AX`), NASDAQ, and NYSE tickers in the same portfolio.
- **Inline portfolio editing** — Click any cell to edit ticker, exchange, or units directly. Add rows with the + button, delete with ✕.
- **Daily cron delivery** — Briefings are pre-generated at 09:30 AEST each morning so they're ready when you open the app.
- **Portfolio persistence** — Holdings saved to Supabase (cloud sync, requires sign-in) or localStorage (offline, no account needed).
- **24h rate limit** — One briefing per day per user to manage API costs.

---

## Who it's for

Individual investors who want a two-minute morning check on their portfolio — not a 30-minute research session. Especially useful for mixed ASX + US portfolios that no single free tool handles well today.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| AI | Anthropic Claude (Haiku for news search, Sonnet for synthesis) |
| Auth + DB | Supabase (Google OAuth, portfolio + briefings tables) |
| Prices | Yahoo Finance unofficial chart API (no key required) |
| Charts | TradingView embed widget |
| Deploy | Vercel (auto-deploy on push to `main`) |
| Tests | Jest + ts-jest (20 unit tests) |

---

## Running locally

### 1. Clone and install

```bash
git clone https://github.com/danang0901/portfolio-briefing-app.git
cd portfolio-briefing-app
npm install
```

### 2. Set up environment variables

Copy the template and fill in your keys:

```bash
cp .env.example .env.local
```

| Variable | Required | Where to get it |
|----------|----------|-----------------|
| `ANTHROPIC_API_KEY` | Yes | [console.anthropic.com](https://console.anthropic.com) |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Supabase project → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Supabase project → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional (cron only) | Supabase project → Settings → API |
| `CRON_SECRET` | Optional (cron only) | Any random secret string |

Without Supabase vars: the app runs fully offline — no auth, no cloud sync, no cron briefings. Holdings are saved to `localStorage`.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Run tests

```bash
npm test
```

20 unit tests covering Yahoo symbol routing, ticker/units validators, and legacy holding coercion.

---

## Deploying to Vercel

1. Push to GitHub
2. Import the repo in [vercel.com](https://vercel.com)
3. Add environment variables under Project Settings → Environment Variables
4. Set Production Branch to `main` under Project Settings → Git
5. Add the cron job by including `vercel.json` (already in the repo — runs at 09:30 AEST daily)

---

## Project structure

```
app/
  page.tsx                    — Main UI (briefing + portfolio tabs)
  api/
    briefing/route.ts         — Streaming AI briefing generation
    prices/route.ts           — Yahoo Finance price fetcher
    portfolio/route.ts        — NL portfolio update (legacy)
    cron/morning-briefing/    — Daily pre-generation cron
lib/
  yahoo-symbol.ts             — ASX/NASDAQ/NYSE → Yahoo Finance symbol
  portfolio-validators.ts     — Ticker + units validation
  supabase.ts                 — Supabase client
__tests__/                    — Unit tests
supabase/migrations/          — SQL schema for portfolios + briefings tables
```

---

## Roadmap

See [TODOS.md](./TODOS.md) for the full roadmap. The next milestone is Stripe integration for Free/Pro tiers ($9 AUD/month). See [to_do.md](./to_do.md) for competitor analysis and pricing rationale.
