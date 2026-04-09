-- Add email opt-in preference to portfolios table.
--
-- NULL   = user has never been asked (show the opt-in modal on next login)
-- true   = user opted in to daily email at 9:30am AEST
-- false  = user explicitly declined
--
-- Default is NULL (not false) so existing users see the opt-in prompt.

ALTER TABLE portfolios
  ADD COLUMN IF NOT EXISTS email_briefing_enabled boolean;

-- Note: intentionally no DEFAULT — NULL means "not yet asked".
