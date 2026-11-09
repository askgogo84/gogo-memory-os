// G8 (Duet parity): "Gogo already knows your setup" — pure summary, owner-only loader, empty-chat card.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { setupKnown } from '../lib/dashboard/setup-known'
let n = 0; const ok = (s: string) => { n++; console.log('PASS', s) }
const full = setupKnown({ whatsapp: true, googleCalendar: { connected: true, extraAccounts: ['goverdhan@tipplr.in'] }, gmail: { connected: true, primaryEmail: 'goverdhan.md@gmail.com', extraAccounts: ['goverdhan@tipplr.in'] }, sites: ['Swiggy', 'BookMyShow'], spaces: true, creditiq: false })
assert.deepEqual(full.known.map(k => k.label), ['WhatsApp', 'Google Calendar', 'Gmail', 'Swiggy', 'BookMyShow', 'Spaces'])
assert.equal(full.known[1].detail, '2 accounts'); assert.match(full.known[2].detail!, /gov…@gmail\.com, gov…@tipplr\.in/, 'emails are masked in the card')
assert.deepEqual(full.missing, []); assert.match(full.line, /^Already set up: WhatsApp, Google Calendar \(2 accounts\), Gmail/)
const none = setupKnown({ whatsapp: false, googleCalendar: { connected: false, extraAccounts: [] }, gmail: { connected: false, extraAccounts: [] }, sites: [], spaces: false, creditiq: false })
assert.deepEqual(none.known, []); assert.deepEqual(none.missing.map(m => m.id), ['calendar', 'gmail', 'sites']); assert.ok(none.missing.every(m => m.href === '/dashboard/connections')); assert.match(none.line, /^Nothing connected yet/)
const partial = setupKnown({ whatsapp: true, googleCalendar: { connected: true, extraAccounts: [] }, gmail: { connected: false, extraAccounts: [] }, sites: [], spaces: false, creditiq: true })
assert.deepEqual(partial.missing.map(m => m.label), ['Gmail', 'Sites you use']); assert.ok(partial.known.some(k => k.id === 'creditiq'))
ok('pure summary: known / missing / one-line, masked emails, connect links')
const loader = readFileSync('lib/dashboard/setup-known.ts', 'utf8')
assert.match(loader, /\.eq\('telegram_id', tg\)\.maybeSingle\(\)/); assert.match(loader, /listExtraCalendarAccounts\(tg\)/); assert.match(loader, /listExtraGmailAccounts\(tg\)/); assert.match(loader, /listSiteConnections\(tg\)/); assert.match(loader, /wa_creditiq_links'\)\.select\('consumer_user_id'\)\.eq\('sender', user\.whatsapp_id\)/)
assert.ok(!/Number\(|parseInt\(/.test(loader), 'owner id stays a string')
const route = readFileSync('app/api/dashboard/chat/route.ts', 'utf8'); assert.match(route, /if \(!threadId && \(globalThis as any\)\.process\?\.env\?\.VERCEL_ENV\) \{[\s\S]*loadSetupKnown\(String\(user\.telegram_id\)\)/); assert.match(route, /brief, setup \}\)/)
const chat = readFileSync('components/dashboard/gogo-chat.tsx', 'utf8'); assert.match(chat, /data-setup-known/); assert.match(chat, /Gogo already knows your setup/); assert.match(chat, /setSetup\(chat\.setup&&Array\.isArray\(chat\.setup\.known\)\?chat\.setup:null\)/)
ok('loader reads only the owner\'s rows (string id); chat GET rides it on the main thread; empty-chat card renders it')
console.log(`verify-setup-known-nov9: ${n} passed`)
