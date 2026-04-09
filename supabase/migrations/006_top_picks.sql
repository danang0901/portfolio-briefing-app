-- Daily shared top picks — one row per generation, served to all signed-in users.
-- Generated once per day by the morning cron; cached and read by all authenticated users.

CREATE TABLE IF NOT EXISTS top_picks (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  picks_data    jsonb       NOT NULL,
  generated_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS top_picks_generated_at_idx ON top_picks (generated_at DESC);

ALTER TABLE top_picks ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read today's picks
CREATE POLICY "Authenticated users can read top picks"
  ON top_picks FOR SELECT
  TO authenticated
  USING (true);

-- Only service role can insert (cron job uses service role key)
-- No INSERT policy for anon/authenticated — enforced by design.
