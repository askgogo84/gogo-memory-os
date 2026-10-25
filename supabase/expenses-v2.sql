-- Upgrade expenses table for AskGogo expense tracker
-- Run in Supabase SQL editor (WhatsApp Bot project)

-- Add telegram_id column if not exists
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS telegram_id BIGINT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS raw_text TEXT;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_expenses_telegram_id ON expenses(telegram_id);
CREATE INDEX IF NOT EXISTS idx_expenses_logged_at ON expenses(logged_at);

-- Backfill telegram_id from whatsapp_id where possible
UPDATE expenses e
SET telegram_id = u.telegram_id
FROM users u
WHERE (u.whatsapp_id = e.whatsapp_id OR u.whatsapp_id = 'whatsapp:' || e.whatsapp_id)
  AND e.telegram_id IS NULL;

-- Verify
SELECT 
  COUNT(*) as total_expenses,
  COUNT(telegram_id) as with_telegram_id,
  COUNT(whatsapp_id) as with_whatsapp_id
FROM expenses;
