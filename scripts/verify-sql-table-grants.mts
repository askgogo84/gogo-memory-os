// Supabase, 30 Oct 2026: tables created in "public" no longer get Data API grants automatically. Without an explicit
// GRANT, supabase-js (which AskGogo uses with the service role) gets "permission denied" on a new table.
// Every SQL file that creates a table must grant it to service_role in the same file (and, per our pattern, revoke
// anon/authenticated). Files below predate the change; their tables already exist in production with grants.
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
const LEGACY = new Set([
  'sql/daily-brief-email.sql',
  'sql/dashboard-experience-personalization.sql',
  'sql/dashboard-whatsapp-otp.sql',
  'sql/document-links.sql',
  'sql/email-lifecycle.sql',
  'sql/friend-contacts.sql',
  'sql/memory-embeddings.sql',
  'sql/shared-memory.sql',
  'sql/travel-tickets.sql',
  'sql/user-preferences.sql',
  'supabase/agent-os-v1.sql',
  'supabase/features-v2.sql',
  'supabase/gogo-cost-guard-v1.sql',
  'supabase/google-calendar-accounts-v1.sql',
  'supabase/institution-pilot-mode-v1.sql',
  'supabase/migrations/20260919184500_agent_steps_threads_schema.sql',
  'supabase/migrations/20260920170000_shared_vault_foundation.sql',
  'supabase/migrations/20260921171000_session_vault_v1.sql',
  'supabase/migrations/20260922154000_agent_open_loops.sql',
  'supabase/migrations/20260926173500_link_vault_items.sql',
  'supabase/migrations/20261010011000_vault_pending_credentials_v1.sql',
  'supabase/mobile-whatsapp-link-v1.sql',
  'supabase/razorpay-v1.sql',
  'supabase/razorpay-v2.sql',
  'supabase/reminder-optout-v1.sql',
  'supabase/skin-check-v1.sql',
  'supabase/split-receipts-v1.sql',
  'supabase/splitwise-v1.sql',
  'supabase/waitlist-v1.sql',
])
const files = execSync('git ls-files "*.sql"', { encoding: 'utf8' }).split('\n').filter(Boolean)
const missing = files.filter(f => !LEGACY.has(f)).filter(f => {
  const sql = readFileSync(f, 'utf8')
  return /\bcreate\s+table\b/i.test(sql) && !/\bgrant\b[^;]*\bto\s+[^;]*\bservice_role\b/i.test(sql)
})
assert.deepEqual(missing, [], 'new SQL creating a table must "grant ... to service_role" (Supabase 30 Oct change): ' + missing.join(', '))
console.log('verify-sql-table-grants: ok (' + files.length + ' sql files, ' + LEGACY.size + ' legacy)')
