-- Signal logs table — tracks ADD/HOLD/TRIM/EXIT signals per user per briefing.
-- Used to compute benchmark-adjusted accuracy once ≥20 signals exist (~30 days).
-- price_at_signal is the last Yahoo Finance close at generation time.

CREATE TABLE IF NOT EXISTS signal_logs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  ticker           text        NOT NULL,
  market           text        NOT NULL DEFAULT 'ASX',
  signal           text        NOT NULL CHECK (signal IN ('ADD', 'HOLD', 'TRIM', 'EXIT')),
  confidence       text        NOT NULL,
  price_at_signal  numeric     -- NULL if price unavailable at log time
);

-- Fast lookup: all signals for a user, newest first
CREATE INDEX IF NOT EXISTS signal_logs_user_created
  ON signal_logs (user_id, created_at DESC);

-- Row-level security: users can only read/insert their own logs
ALTER TABLE signal_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own signal logs"
  ON signal_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own signal logs"
  ON signal_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access for signal_logs"
  ON signal_logs FOR ALL
  USING (auth.role() = 'service_role');
