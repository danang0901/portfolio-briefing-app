# Portfolio Briefing — To Do

## Monetization

**Priority:** P1 — implement after external user validation

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
- Actionable signals (ADD/HOLD/TRIM/EXIT) with reasoning, not just prices
- Works for mixed ASX + US portfolios
- Replaces the morning scroll in under 2 minutes

**Closest threat:** A competitor builds a similar product on top of OpenAI's API.
Moat: (1) established user habit, (2) multi-market data integration, (3) trust from accuracy.

---

### Recommended Pricing Model

**Freemium + Pro tier**

| Tier | Price | Limits |
|------|-------|--------|
| Free | $0 | Up to 5 holdings, 1 briefing/day (cached), ASX + US |
| Pro | $9 AUD/month | Unlimited holdings, daily briefing, 30-day history |

**Annual option:** ~$79 AUD/year (~30% discount). Defer until monthly churn is measurable.

**Do NOT build:** pay-per-briefing. Creates psychological friction against daily use — the habit you need to form.

---

### Implementation Order

1. **Stripe integration** — subscription + billing (Free/Pro tiers)
2. **Usage tracking in Supabase** — briefings/day count, holdings count per user
3. **Paywall enforcement** — check tier before generating in `/api/briefing`
4. **Upgrade prompt** — shown when free user hits limit ("You have 5 holdings — upgrade to add more")
5. **Annual billing** — add after validating monthly retention

---

## Future Features

- Mobile PWA / push notifications for morning briefing delivery
- Email delivery option (cron already runs, just needs SMTP)
- Portfolio performance tracking over time (Sharesight's core feature)
- Multi-portfolio support (e.g. personal vs SMSF)
- Watchlist (stocks not yet owned but monitoring)
- LSE and other exchange support (extend `market` field in Holding type)
