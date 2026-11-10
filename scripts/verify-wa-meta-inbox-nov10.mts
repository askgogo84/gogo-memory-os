// The Meta webhook's durable inbox: the migration on real Postgres (PGlite), the claim rules, the drain, and the
// webhook with GOGO_WA_META_INBOX=1 (answers at once, hands over in order). Offline: stubbed network.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteSupabase } from './lib/pglite-supabase.mts'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const inbox = await import('../lib/channels/whatsapp-provider/meta-inbox.ts')

let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const pg = new PGlite()
await pg.exec('create role anon; create role authenticated; create role service_role;')
const UP = readFileSync(new URL('../supabase/migrations/20261110190000_wa_meta_inbox.sql', import.meta.url), 'utf8')
await pg.exec(UP); await pg.exec(UP)
const base = pgliteSupabase(pg) as any
// The test adapter has no upsert; give it the one call the inbox makes.
const db = { ...base, rpc: async (fn: string, args: any) => fn === 'claim_wa_meta_inbox' ? { data: (await pg.query('select * from claim_wa_meta_inbox($1, $2)', [args.p_limit, args.p_lease_seconds])).rows, error: null } : base.rpc(fn, args), from: (t: string) => ({ ...base.from(t), upsert: async (rows: any[], o: any) => {
  try { for (const r of rows) await pg.query(`insert into ${t} (message_id, sender, params) values ($1,$2,$3) on conflict (message_id) do nothing`, [r.message_id, r.sender, JSON.stringify(r.params)]); return { error: null } } catch (e: any) { return { error: { message: e.message, code: e.code } } }
} }) }
const wamid = (n: number) => `wamid.HBgMOTE5OTAwMDAwMDAy${String(n).padStart(4, '0')}`
const rows = async () => (await pg.query('select message_id, sender, status, attempts, params is null as cleared from wa_meta_inbox order by received_at, message_id')).rows as any[]

// 1. Store: a redelivery is not stored twice; bad ids and senders are refused by the table.
ok(await inbox.storeInbound([{ id: wamid(1), from: '919900000001', params: { Body: 'one' } }, { id: wamid(2), from: '919900000001', params: { Body: 'two' } }, { id: wamid(3), from: '919900000002', params: { Body: 'three' } }], db), 'messages are stored')
ok(await inbox.storeInbound([{ id: wamid(1), from: '919900000001', params: { Body: 'one again' } }], db), 'a redelivery is accepted')
eq((await rows()).length, 3, 'and stored once')
eq(await inbox.storeInbound([{ id: 'SMnot-a-wamid', from: '919900000001', params: {} }], db), false, 'a malformed id is refused')

// 2. Claim: at most one message per person, oldest first, never while that person's earlier one is in hand.
const c1 = (await pg.query('select message_id from claim_wa_meta_inbox(10, 150)')).rows.map((r: any) => r.message_id).sort()
eq(c1, [wamid(1), wamid(3)], "the first claim takes each person's oldest message")
eq((await pg.query('select message_id from claim_wa_meta_inbox(10, 150)')).rows, [], "a second claim takes nothing while those are being handled")
await pg.query(`update wa_meta_inbox set status='done', params=null where message_id=$1`, [wamid(1)])
eq((await pg.query('select message_id from claim_wa_meta_inbox(10, 150)')).rows.map((r: any) => r.message_id), [wamid(2)], "the person's next message comes only after the first is done")
await pg.query(`update wa_meta_inbox set lease_until = now() - interval '1 second' where message_id=$1`, [wamid(3)])
eq((await pg.query('select message_id, attempts from claim_wa_meta_inbox(10, 150)')).rows, [{ message_id: wamid(3), attempts: 2 }], "a crashed worker's message is picked up again when its lease runs out")
const sec = await pg.query(`select relrowsecurity as rls, has_table_privilege('anon','public.wa_meta_inbox','select') as anon, has_function_privilege('authenticated','public.claim_wa_meta_inbox(integer,integer)','execute') as authed from pg_class where oid='public.wa_meta_inbox'::regclass`)
eq(sec.rows[0], { rls: true, anon: false, authed: false }, 'only the service role can reach the inbox')

// 3. Drain: hands over in order, clears the text of finished rows, retries a failure, gives up after five tries.
await pg.query('delete from wa_meta_inbox')
await inbox.storeInbound([1, 2, 3].map(n => ({ id: wamid(10 + n), from: '919900000001', params: { Body: `m${n}` } })).concat([{ id: wamid(20), from: '919900000002', params: { Body: 'other' } }]), db)
const order: string[] = []
const r1 = await inbox.drainMetaInbox({ db, forward: async p => { order.push(p.Body); return { result: 'done', status: 200 } } })
eq(r1, { done: 4, retried: 0, failed: 0 }, 'everything is handed over')
eq(order.filter(b => b.startsWith('m')), ['m1', 'm2', 'm3'], "one person's messages go in the order they were sent")
ok((await rows()).every(r => r.status === 'done' && r.cleared), 'finished rows keep no message text')
await inbox.storeInbound([{ id: wamid(30), from: '919900000003', params: { Body: 'x' } }], db)
let tries = 0
for (let i = 0; i < 7; i++) await inbox.drainMetaInbox({ db, forward: async () => { tries++; return { result: 'retry', status: 502 } } })
eq([tries, (await rows()).find(r => r.message_id === wamid(30))!.status], [5, 'failed'], 'a message the pipeline keeps refusing is tried five times, then marked failed')
await inbox.storeInbound([{ id: wamid(31), from: '919900000004', params: { Body: 'y' } }], db)
eq(await inbox.drainMetaInbox({ db, forward: async () => ({ result: 'busy', status: 503 }) }), { done: 1, retried: 0, failed: 0 }, "the pipeline's Busy is final: the person was already asked to resend")

// 4. Forwarding: signed for the configured URL only, no redirects, nothing without a secret.
const env = { TWILIO_AUTH_TOKEN: 'pipeline-secret', TWILIO_WHATSAPP_WEBHOOK_URL: 'https://app.askgogo.in/api/webhooks/whatsapp' }
let seen: any = null
const f = await inbox.forwardToPipeline({ From: 'whatsapp:+919900000001', Body: 'hi' }, { env, fetchImpl: (async (u: any, i: any) => { seen = { u: String(u), i }; return new Response('', { status: 200 }) }) as any })
eq([f.result, seen.u, seen.i.redirect], ['done', 'https://app.askgogo.in/api/webhooks/whatsapp', 'error'], 'forwarded to the configured pipeline, redirects refused')
eq((await inbox.forwardToPipeline({ Body: 'x' }, { env: { TWILIO_AUTH_TOKEN: 'x', TWILIO_WHATSAPP_WEBHOOK_URL: 'https://evil.example/api/webhooks/whatsapp?x=1' }, fetchImpl: (async () => { throw new Error('must not be called') }) as any })).result, 'retry', 'a configured URL with a query string is not used')
eq((await inbox.forwardToPipeline({ Body: 'x' }, { env: { TWILIO_WHATSAPP_WEBHOOK_URL: env.TWILIO_WHATSAPP_WEBHOOK_URL }, fetchImpl: (async () => { throw new Error('must not be called') }) as any })).result, 'retry', 'nothing is sent without the pipeline secret')

// 5. The webhook with the inbox on: stores and answers at once; with it off, unchanged.
const route = readFileSync(new URL('../app/api/webhooks/whatsapp-meta/route.ts', import.meta.url), 'utf8')
ok(/if \(metaInboxEnabled\(\)\) \{[\s\S]{0,400}storeInbound\([\s\S]{0,200}status: 503[\s\S]{0,300}after\(\(\) => drainMetaInbox/.test(route), 'with the inbox on, the webhook stores the messages (503 if it cannot), hands over after the response and answers at once')
ok(route.indexOf('verifyMetaSignature(') < route.indexOf('storeInbound('), 'nothing is stored before the signature is checked')
ok(/waProviderFor\(m\.from\) === 'meta'/.test(route) && route.indexOf("waProviderFor(m.from) === 'meta'") < route.indexOf('storeInbound('), 'only senders served by Meta are stored')
const cron = readFileSync(new URL('../app/api/cron/wa-meta-inbox/route.ts', import.meta.url), 'utf8')
ok(/CRON_SECRET/.test(cron) && /if \(!metaInboxEnabled\(\)\) return NextResponse\.json\(\{ ok: true, skipped: 'inbox_off' \}\)/.test(cron), 'the drain cron needs the cron secret and does nothing while the inbox is off')
ok(JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons.some((c: any) => c.path === '/api/cron/wa-meta-inbox' && c.schedule === '* * * * *'), 'it runs every minute')
const mod = readFileSync(new URL('../lib/channels/whatsapp-provider/meta-inbox.ts', import.meta.url), 'utf8')
ok(!/console\.(?:log|error)\([^\n]*(?:params|Body|sender|from\b)/.test(mod), 'no message text or sender is logged')
void createHmac

// 6. Rollback.
await pg.exec(readFileSync(new URL('../supabase/migrations/20261110190000_wa_meta_inbox.rollback.sql', import.meta.url), 'utf8'))
eq((await pg.query(`select count(*)::int n from pg_tables where tablename='wa_meta_inbox'`)).rows[0], { n: 0 }, 'rollback removes the inbox')
await pg.close()
console.log(`WA_META_INBOX_OK ${checks} checks`)
