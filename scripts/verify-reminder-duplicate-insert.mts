// 23 Oct live: a second identical reminder made the DB trigger skip the insert (0 rows → PGRST116) and WhatsApp
// answered "services temporarily unavailable". A DB-skipped duplicate is "already set". Proven against the real
// trigger in PGlite. Run: npx tsx scripts/verify-reminder-duplicate-insert.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite()
await db.exec(`create table public.reminders (id bigserial primary key, telegram_id bigint, chat_id bigint, message text, remind_at timestamptz, sent boolean default false, timezone text, whatsapp_to text, recurring_pattern text, is_recurring boolean default false, created_at timestamptz default now());`)
const trigger = readFileSync('supabase/reminder-insert-idempotency-20260915.sql', 'utf8')
await db.exec(trigger.replace(/\bgrant\b[^;]*;/gi, '').replace(/\brevoke\b[^;]*;/gi, ''))
const ins = `insert into public.reminders (telegram_id, chat_id, message, remind_at, sent, timezone) values (1, 1, 'Check EK500 landing', '2026-10-24T02:25:00+05:30', false, 'Asia/Kolkata') returning id`
assert.equal((await db.query(ins)).rows.length, 1)
assert.equal((await db.query(ins)).rows.length, 0, 'the trigger skips an identical pending reminder: 0 rows (PostgREST reports PGRST116)')
const src = readFileSync('lib/bot/process-message.ts', 'utf8')
const i = src.indexOf("if (error && String((error as any).code || '') === 'PGRST116') {")
assert.ok(i > 0 && i < src.indexOf("console.error('REMINDER INSERT FAILED:'"), 'PGRST116 handled as already-set before the failure path')
assert.match(src.slice(i, i + 700), /return\n  \}/)
console.log('Reminder duplicate: DB-skipped identical reminder is "already set", not an outage')
