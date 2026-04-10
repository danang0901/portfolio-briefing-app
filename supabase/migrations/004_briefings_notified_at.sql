-- Add notified_at to briefings so the email cron can find un-emailed briefings
-- without double-sending. NULL = not yet emailed; timestamptz = email sent at.

ALTER TABLE briefings
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- Index for the email cron query: today's briefings where notified_at is null
CREATE INDEX IF NOT EXISTS briefings_unnotified
  ON briefings (created_at DESC)
  WHERE notified_at IS NULL;
