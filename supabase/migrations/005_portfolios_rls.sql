-- Enable RLS on portfolios table and add user-scoped access policies.
--
-- The portfolios table was created via the Supabase dashboard and had no RLS,
-- which caused Supabase to flag it as a critical security vulnerability.
-- This migration retroactively enables RLS using the same policy pattern
-- as briefings (20260328_briefings_table.sql) and signal_logs (002_signal_logs.sql).
--
-- Access model:
--   - Authenticated users: can read/insert/update only their own row
--   - Service role key (all cron routes): bypasses RLS automatically, no policy needed
--   - Unauthenticated (anon) requests: auth.uid() returns null → USING clause is false
--     for all rows → zero rows visible. Correct safe default, no extra policy needed.
--   - DELETE: no policy added. Frontend never deletes portfolios. A future frontend
--     DELETE without a policy will get a permission-denied error (the safe default).

ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;

-- Users can read only their own portfolio row
CREATE POLICY "Users can read own portfolio"
  ON portfolios FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert their own portfolio row (first-time upsert on sign-in)
CREATE POLICY "Users can insert own portfolio"
  ON portfolios FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own portfolio row (holdings changes, email_briefing_enabled)
CREATE POLICY "Users can update own portfolio"
  ON portfolios FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
