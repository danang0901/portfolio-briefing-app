-- Briefings table — stores generated morning briefings per user per day.
-- The cron route inserts here at 9:30am AEST; the app reads back on load.

CREATE TABLE IF NOT EXISTS briefings (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  briefing_data    jsonb       NOT NULL,
  portfolio_snapshot jsonb     NOT NULL
);

-- Index for fast lookup of today's briefing per user
CREATE INDEX IF NOT EXISTS briefings_user_created
  ON briefings (user_id, created_at DESC);

-- Row-level security: users can only read/insert their own briefings
ALTER TABLE briefings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own briefings"
  ON briefings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own briefings"
  ON briefings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Service role bypass (used by the cron route with SUPABASE_SERVICE_ROLE_KEY)
CREATE POLICY "Service role full access"
  ON briefings FOR ALL
  USING (auth.role() = 'service_role');
