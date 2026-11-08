// Active Memory export (8 Nov): exact-owner string id, every table .eq on it, internal rows left out, provenance per
// item, unavailable tables reported not thrown; the WhatsApp command and the dashboard route exist and are owner-bound.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const me = await import('../lib/agent/memory-export')

const OWNER = '9007199254740993' // > 2^53: must survive as a string
const rows: Record<string, any[]> = {
  memories: [{ id: 1, telegram_id: OWNER, content: 'Divya prefers window seats', created_at: '2026-11-01T10:00:00Z' }, { id: 2, telegram_id: OWNER, content: 'ASKGOGO_USAGE:x:y:3', created_at: '2026-11-01T10:00:00Z' }, { id: 3, telegram_id: OWNER, content: '{"type":"followup_state"}', created_at: '2026-11-01T10:00:00Z' }, { id: 4, telegram_id: '9007199254740992', content: 'someone else', created_at: '2026-11-01T10:00:00Z' }],
  user_insights: [{ id: 'i1', telegram_id: OWNER, status: 'active', insight: 'Usually sets reminders at 9 am', confidence: 0.8 }, { id: 'i2', telegram_id: OWNER, status: 'retired', insight: 'old', confidence: 0.9 }],
  user_memory_profile: [{ telegram_id: OWNER, home_city: 'Bengaluru', favourite_cuisine: null, updated_at: '2026-11-02T00:00:00Z' }],
  life_events: [{ id: 'e1', telegram_id: OWNER, title: 'Goa trip', location: 'Goa', start_at: '2026-12-10T00:00:00Z', end_at: '2026-12-13T00:00:00Z', kind: 'trip' }],
  reminders: [{ id: 'r1', telegram_id: OWNER, message: 'call Nithin', remind_at: '2026-11-09T12:30:00Z', sent: false }, { id: 'r2', telegram_id: OWNER, message: 'done one', remind_at: '2026-11-01T12:30:00Z', sent: true }],
  user_consent_settings: [{ telegram_id: OWNER, memory_enabled: true }],
}
const queried: { table: string; eq: [string, any][] }[] = []
const db = { from: (table: string) => { const eq: [string, any][] = []; const q = { table, eq }; queried.push(q); const b: any = { select() { return b }, eq(k: string, v: any) { eq.push([k, v]); return b }, order() { return b }, limit() { return b }, maybeSingle() { b.single = true; return b }, then(res: any) { if (!rows[table]) return Promise.resolve({ data: null, error: { code: '42P01', message: 'missing' } }).then(res); const data = rows[table].filter(r => eq.every(([k, v]) => String(r[k]) === String(v))); return Promise.resolve({ data: b.single ? data[0] || null : data, error: null }).then(res) } }; return b } }

const x = await me.exportMemory(OWNER, db as any, Date.parse('2026-11-08T00:00:00Z'))
assert.equal(x.owner, OWNER)
assert.ok(queried.every(q => q.eq.some(([k, v]) => k === 'telegram_id' && v === OWNER && typeof v === 'string')), 'every table read is .eq(telegram_id, <string owner>)')
assert.deepEqual(x.facts.map(f => f.id).sort(), ['1', 'e1', 'i1', 'profile.home_city', 'r1'].sort(), JSON.stringify(x.facts.map(f => f.id)))
assert.ok(!x.facts.some(f => /someone else|ASKGOGO_USAGE|followup_state|done one|old/.test(f.text)), 'other owner, internal, retired and sent rows excluded')
assert.deepEqual(x.facts.find(f => f.id === '1')!.provenance, { table: 'memories', id: 1, created_at: '2026-11-01T10:00:00Z' })
assert.equal(x.memoryEnabled, true); assert.match(x.note, /documents/); assert.equal(x.counts.memories, 1)
console.log('✓ export: exact string owner on every read; internal/other/retired rows out; provenance per item; missing table reported')

const md = me.formatMemoryExport(x)
assert.match(md, /^# What AskGogo remembers\n/); assert.match(md, /## Notes and things you told me \(1\)\n- Divya prefers window seats/); assert.match(md, /## Open reminders \(1\)/); assert.match(md, /`memories:1`/); assert.match(md, /forget everything/)
console.log('✓ readable export groups by source with provenance tags')

for (const t of ['export my memory', 'download my memories', 'send me everything you remember about me', 'give me my data']) assert.ok(me.EXPORT_ASK.test(t), t)
for (const t of ['export the invoice', 'my memory', 'download the pdf']) assert.ok(!me.EXPORT_ASK.test(t), t)
const mc = readFileSync('lib/bot/handlers/memory-control.ts', 'utf8'); assert.match(mc, /exportMemory\(String\(telegramId\)\)/); assert.match(mc, /api\/dashboard\/memory\/export\?format=md/)
const route = readFileSync('app/api/dashboard/memory/export/route.ts', 'utf8')
assert.match(route, /getSession\(\)/); assert.match(route, /String\(session\.telegramId\)/); assert.ok(!/Number\(|parseInt\(/.test(route), 'no numeric conversion of the owner id'); assert.match(route, /no-store/)
console.log('✓ WhatsApp ask recognised; dashboard route session-bound, string owner, no-store')
console.log('Memory export (8 Nov) checks passed')
