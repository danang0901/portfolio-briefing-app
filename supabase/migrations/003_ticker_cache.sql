-- Shared ticker data cache: one row per (ticker, market, date).
-- Populated by the briefing API on first daily request; all subsequent
-- users that day hit the cache instead of calling Yahoo Finance / ASX / Stocktwits.
--
-- RLS disabled — table contains only public market data, no user PII.

CREATE TABLE IF NOT EXISTS ticker_daily_cache (
  ticker                text        NOT NULL,
  market                text        NOT NULL,
  date                  date        NOT NULL,
  ta_data               jsonb,
  asx_announcements     jsonb,       -- string[] stored as JSON array
  stocktwits_sentiment  text,        -- '' = no divergence; NULL = not yet fetched / not applicable
  computed_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, market, date)
);

-- Allow the API (anon key) to read and write — no user data in this table
ALTER TABLE ticker_daily_cache DISABLE ROW LEVEL SECURITY;

-- Auto-clean rows older than 7 days to keep the table small
-- (optional: run manually or via a pg_cron job if available on your Supabase plan)
-- DELETE FROM ticker_daily_cache WHERE date < CURRENT_DATE - INTERVAL '7 days';
