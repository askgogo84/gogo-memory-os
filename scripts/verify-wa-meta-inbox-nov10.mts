// The Meta webhook's durable inbox: the migration on real Postgres (PGlite), the claim rules, the drain, and the
// webhook with GOGO_WA_META_INBOX=1 (answers at once, hands over in order). Offline: stubbed network.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgliteSupabase } from './lib/pglite-supabase.mts'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
// The resend notice goes only to people served by Meta: in this test everyone is (fake config, no network used).
process.env.GOGO_META_WA_TOKEN = 'test'; process.env.GOGO_META_WA_PHONE_ID = '100000000000001'; process.env.GOGO_WA_PROVIDER = 'meta'
const inbox = await import('../lib/channels/whatsapp-provider/meta-inbox.ts')

let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const pg = new PGlite()
await pg.exec('create role anon; create role authenticated; create role service_role;')
const UP = readFileSync(new URL('../supabase/migrations/20261110190000_wa_meta_inbox.sql', import.meta.url), 'utf8')
await pg.exec(UP); await pg.exec(UP)
const base = pgliteSupabase(pg) as any
// The test adapter has no upsert; give it the one call the inbox makes, as ONE statement like PostgREST (so rows
// stored together share the same now(), and only seq keeps their order).
const db = { ...base, rpc: async (fn: string, args: any) => fn === 'claim_wa_meta_inbox' ? { data: (await pg.query('select * from claim_wa_meta_inbox($1, $2)', [args.p_limit, args.p_lease_seconds])).rows, error: null }
  : fn === 'sweep_wa_meta_inbox' ? { data: (await pg.query('select * from sweep_wa_meta_inbox()')).rows, error: null } : base.rpc(fn, args),
  from: (t: string) => ({ ...base.from(t), upsert: async (rows: any[]) => {
    try { const vals = rows.map((_, k) => `($${4 * k + 1},$${4 * k + 2},$${4 * k + 3},$${4 * k + 4})`).join(','); await pg.query(`insert into ${t} (message_id, sender, params, no_notice) values ${vals} on conflict (message_id) do nothing`, rows.flatMap(r => [r.message_id, r.sender, JSON.stringify(r.params), Boolean(r.no_notice)])); return { error: null } } catch (e: any) { return { error: { message: e.message, code: e.code } } }
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
eq((await pg.query(`select count(distinct received_at)::int n from wa_meta_inbox`)).rows[0], { n: 1 }, 'messages stored together share one arrival time (one statement)')
eq((await pg.query('select message_id from claim_wa_meta_inbox(10, 150)')).rows, [], 'a second claim takes nothing while those are being handled')
await pg.query(`update wa_meta_inbox set status='done', params=null where message_id=$1`, [wamid(1)])
eq((await pg.query('select message_id from claim_wa_meta_inbox(10, 150)')).rows.map((r: any) => r.message_id), [wamid(2)], "the person's next message comes only after the first is done, in the order sent")
await pg.query(`update wa_meta_inbox set lease_until = now() - interval '1 second' where message_id=$1`, [wamid(3)])
eq((await pg.query('select message_id, attempts from claim_wa_meta_inbox(10, 150)')).rows, [{ message_id: wamid(3), attempts: 2 }], "a crashed worker's message is picked up again when its lease runs out")
const sec = await pg.query(`select relrowsecurity as rls, has_table_privilege('anon','public.wa_meta_inbox','select') as anon, has_function_privilege('authenticated','public.claim_wa_meta_inbox(integer,integer)','execute') as authed, has_function_privilege('anon','public.sweep_wa_meta_inbox()','execute') as sweep from pg_class where oid='public.wa_meta_inbox'::regclass`)
eq(sec.rows[0], { rls: true, anon: false, authed: false, sweep: false }, 'only the service role can reach the inbox')
const fnSrc = readFileSync(new URL('../supabase/migrations/20261110190000_wa_meta_inbox.sql', import.meta.url), 'utf8')
ok(/picked as \([\s\S]*?where \(i\.status = 'pending' and i\.next_attempt_at <= clock_timestamp\(\)\) or \(i\.status = 'processing' and i\.lease_until <= clock_timestamp\(\)\)[\s\S]*?for update of i skip locked/.test(fnSrc), 'the status is checked again on the locked row, so two workers cannot claim the same message (a race PGlite cannot run: checked by reading the SQL against Postgres row-locking rules, not by a two-session run)')

// 3. Drain.
const reset = async () => pg.query('delete from wa_meta_inbox')
await reset()
await inbox.storeInbound([1, 2, 3].map(n => ({ id: wamid(10 + n), from: '919900000001', params: { Body: `m${n}` } })).concat([{ id: wamid(20), from: '919900000002', params: { Body: 'other' } }]), db)
const order: string[] = []
const okForward = async (p: any) => { order.push(p.Body); return { result: 'done' as const, status: 200 } }
eq(await inbox.drainMetaInbox({ db, forward: okForward }), { done: 4, retried: 0, gaveUp: 0, lost: 0, rounds: 4 }, 'one call hands over quick follow-ups at once, one per person per round, not one a minute')
eq(order.filter(b => b.startsWith('m')), ['m1', 'm2', 'm3'], "one person's messages go in the order they were sent, even though they arrived together")
ok((await rows()).every(r => r.status === 'done' && r.cleared), 'finished rows keep no message text')
// A failure waits and keeps the order: the next message does not overtake it.
await reset()
await inbox.storeInbound([{ id: wamid(40), from: '919900000003', params: { Body: 'first' } }, { id: wamid(41), from: '919900000003', params: { Body: 'second' } }], db)
let fail = true; const sent: string[] = []
const flaky = async (p: any) => { if (fail) return { result: 'retry' as const, status: 502 }; sent.push(p.Body); return { result: 'done' as const, status: 200 } }
for (let i = 0; i < 6; i++) await inbox.drainMetaInbox({ db, forward: flaky })
const after1 = (await pg.query(`select attempts, status, next_attempt_at > now() + interval '20 seconds' as waits from wa_meta_inbox where message_id=$1`, [wamid(40)])).rows[0]
eq(after1, { attempts: 1, status: 'pending', waits: true }, 'six quick drains during an outage use one try, then the message waits')
eq(sent, [], 'and the second message does not overtake the first')
fail = false
await pg.query(`update wa_meta_inbox set next_attempt_at = now() - interval '1 second'`)
for (let i = 0; i < 3; i++) await inbox.drainMetaInbox({ db, forward: flaky })
eq(sent, ['first', 'second'], 'when the pipeline is back, both are delivered in order')
eq([inbox.retryDelayMs(1), inbox.retryDelayMs(2), inbox.retryDelayMs(5), inbox.retryDelayMs(30)], [30_000, 60_000, 480_000, 1_800_000], 'the wait grows from 30 seconds to at most 30 minutes')
// Given up only after six hours, with the text cleared and the person told.
await reset()
await inbox.storeInbound([{ id: wamid(50), from: '919900000004', params: { Body: 'old' } }], db)
await pg.query(`update wa_meta_inbox set received_at = now() - interval '7 hours'`)
const told: string[] = []
eq((await inbox.drainMetaInbox({ db, forward: okForward, notify: async s => { told.push(s) } })).gaveUp, 1, 'a message older than six hours is given up')
eq([told, (await rows())[0].status, (await rows())[0].cleared], [['919900000004'], 'failed', true], 'its text is cleared and the person is asked to send it again')
// A row stuck in processing on its last chance is also given up after the window, not kept for ever.
await reset()
await inbox.storeInbound([{ id: wamid(51), from: '919900000005', params: { Body: 'stuck' } }], db)
await pg.query(`update wa_meta_inbox set status='processing', attempts=9, lease_until=now()-interval '1 minute', received_at=now()-interval '7 hours'`)
await inbox.drainMetaInbox({ db, forward: okForward, notify: async () => {} })
eq([(await rows())[0].status, (await rows())[0].cleared], ['failed', true], 'a stuck row is given up and cleared')
// A stale worker cannot overwrite a newer claim.
await reset()
await inbox.storeInbound([{ id: wamid(60), from: '919900000006', params: { Body: 'x' } }], db)
const lost = await inbox.drainMetaInbox({ db, forward: async () => { await pg.query(`update wa_meta_inbox set lease_id = gen_random_uuid()`); return { result: 'done', status: 200 } } })
eq([lost.lost, lost.done, (await rows())[0].status], [1, 0, 'processing'], 'a finish written by a worker whose claim was taken over changes nothing')
// Finished rows are deleted after three days.
await pg.query(`update wa_meta_inbox set status='done', params=null, finished_at=now()-interval '4 days'`)
await inbox.drainMetaInbox({ db, forward: okForward })
eq((await rows()).length, 0, 'finished rows older than three days are deleted')
// The notice: once a day per person, never after STOP, only inside 24 hours, only to people on the Meta number.
await reset()
const tell: string[] = []; const tellDrain = () => inbox.drainMetaInbox({ db, forward: okForward, notify: async s => { tell.push(s) } })
await inbox.storeInbound([{ id: wamid(80), from: '919900000010', params: { Body: 'a' } }, { id: wamid(81), from: '919900000010', params: { Body: 'b' } }, { id: wamid(82), from: '919900000011', params: { Body: 'STOP' } }, { id: wamid(83), from: '919900000012', params: { Body: 'old' } }], db)
await pg.query(`update wa_meta_inbox set received_at = now() - interval '7 hours' where message_id in ($1,$2)`, [wamid(80), wamid(82)])
await pg.query(`update wa_meta_inbox set received_at = now() - interval '30 hours' where message_id = $1`, [wamid(83)])
await pg.query(`update wa_meta_inbox set next_attempt_at = now() + interval '1 hour' where message_id = $1`, [wamid(81)])
eq((await pg.query(`select no_notice from wa_meta_inbox where message_id=$1`, [wamid(82)])).rows[0], { no_notice: true }, 'a STOP message is marked when it is stored')
await tellDrain()
eq(tell, ['919900000010'], 'only the person who wrote in the last day and did not send STOP is asked to resend')
await pg.query(`update wa_meta_inbox set received_at = now() - interval '7 hours', next_attempt_at = now() + interval '1 hour' where message_id = $1`, [wamid(81)])
await tellDrain()
eq(tell, ['919900000010'], 'a second give-up for the same person the same day sends no second notice')
process.env.GOGO_WA_PROVIDER = ''
await pg.query(`delete from wa_meta_inbox`); await inbox.storeInbound([{ id: wamid(84), from: '919900000013', params: { Body: 'x' } }], db)
await pg.query(`update wa_meta_inbox set received_at = now() - interval '7 hours'`); await tellDrain()
eq(tell, ['919900000010'], 'nobody moved back to Twilio is messaged from the inbox')
process.env.GOGO_WA_PROVIDER = 'meta'
// The time budget: no round starts with under a minute left, and hand-overs get only what is left.
await reset()
await inbox.storeInbound([1, 2, 3].map(n => ({ id: wamid(90 + n), from: '919900000020', params: { Body: `t${n}` } })), db)
let clock = 0; const timeouts: number[] = []
const slow = async (_p: any, o: any) => { timeouts.push(o.timeoutMs); clock += 30_000; return { result: 'done' as const, status: 200 } }
const timed = await inbox.drainMetaInbox({ db, forward: slow as any, now: () => clock })
eq([timed.rounds, timed.done, timeouts], [2, 2, [110_000, 80_000]], 'rounds stop when under a minute is left, and each hand-over is cut off before the limit')
ok(/\(i\.status = 'pending' and i\.next_attempt_at <= clock_timestamp\(\)\)/.test(fnSrc), 'the wait before a retry is checked again on the locked row')

// A NUL character does not block the batch.
ok(await inbox.storeInbound([{ id: wamid(70), from: '919900000007', params: { Body: 'a\u0000b' } }, { id: wamid(71), from: '919900000008', params: { Body: 'fine' } }], db), 'a message with a NUL character is stored')
eq((await pg.query(`select params->>'Body' b from wa_meta_inbox where message_id=$1`, [wamid(70)])).rows[0], { b: 'ab' }, 'with the NUL removed, and the rest of the batch with it')

// 4. Forwarding: signed for the configured URL only, no redirects, nothing without a secret.
const env = { TWILIO_AUTH_TOKEN: 'pipeline-secret', TWILIO_WHATSAPP_WEBHOOK_URL: 'https://app.askgogo.in/api/webhooks/whatsapp' }
let seen: any = null
const f = await inbox.forwardToPipeline({ From: 'whatsapp:+919900000001', Body: 'hi' }, { env, fetchImpl: (async (u: any, i: any) => { seen = { u: String(u), i }; return new Response('', { status: 200 }) }) as any })
eq([f.result, seen.u, seen.i.redirect], ['done', 'https://app.askgogo.in/api/webhooks/whatsapp', 'error'], 'forwarded to the configured pipeline, redirects refused')
eq((await inbox.forwardToPipeline({ Body: 'x' }, { env: { TWILIO_AUTH_TOKEN: 'x', TWILIO_WHATSAPP_WEBHOOK_URL: 'https://evil.example/api/webhooks/whatsapp?x=1' }, fetchImpl: (async () => { throw new Error('must not be called') }) as any })).result, 'retry', 'a configured URL with a query string is not used')
eq((await inbox.forwardToPipeline({ Body: 'x' }, { env: { TWILIO_WHATSAPP_WEBHOOK_URL: env.TWILIO_WHATSAPP_WEBHOOK_URL }, fetchImpl: (async () => { throw new Error('must not be called') }) as any })).result, 'retry', 'nothing is sent without the pipeline secret')

// 5. The webhook with the inbox on: stores and answers at once; with it off, unchanged.
const route = readFileSync(new URL('../app/api/webhooks/whatsapp-meta/route.ts', import.meta.url), 'utf8')
ok(/if \(metaInboxEnabled\(\)\) \{[\s\S]{0,400}storeInbound\([\s\S]{0,200}status: 503[\s\S]{0,300}after\(\(\) => drainMetaInbox\(\)/.test(route), 'with the inbox on, the webhook stores the messages (503 if it cannot), hands over after the response and answers at once')
ok(route.indexOf('verifyMetaSignature(') < route.indexOf('storeInbound('), 'nothing is stored before the signature is checked')
ok(/waProviderFor\(m\.from\) === 'meta'/.test(route) && route.indexOf("waProviderFor(m.from) === 'meta'") < route.indexOf('storeInbound('), 'only senders served by Meta are stored')
const cron = readFileSync(new URL('../app/api/cron/wa-meta-inbox/route.ts', import.meta.url), 'utf8')
ok(/CRON_SECRET/.test(cron), 'the drain cron needs the cron secret')
ok(JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons.some((c: any) => c.path === '/api/cron/wa-meta-inbox' && c.schedule === '* * * * *'), 'it runs every minute')
const mod = readFileSync(new URL('../lib/channels/whatsapp-provider/meta-inbox.ts', import.meta.url), 'utf8')
ok(!/console\.(?:log|error)\([^\n]*(?:\bparams\b|\bBody\b|\bsender\b|\bfrom\b|\.sender|row\.params)/.test(mod), 'no message text or sender is logged')
void createHmac

const pipe = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
ok(/inboundClaim\.status === 'claimed' && req\.headers\.get\('x-gogo-meta-inbox'\) === '1'\) return new NextResponse\('InFlight', \{ status: 503 \}\)/.test(pipe) && pipe.indexOf("'InFlight'") > pipe.indexOf('signatureAudit.reject'), 'a hand-over still running answers InFlight to the inbox, after the signature check')
eq((await inbox.forwardToPipeline({ Body: 'x' }, { env, fetchImpl: (async () => new Response('InFlight', { status: 503 })) as any })).result, 'retry', 'InFlight makes the inbox wait and try again, not mark it done')
eq([inbox.metaInboxDraining({ GOGO_WA_META_INBOX: 'drain' }), inbox.metaInboxEnabled({ GOGO_WA_META_INBOX: 'drain' }), inbox.metaInboxDraining({})], [true, false, false], "'drain' stops storing but keeps emptying the inbox")
ok(/if \(!metaInboxDraining\(\)\) return NextResponse\.json\(\{ ok: true, skipped: 'inbox_off' \}\)/.test(cron), 'the cron keeps draining in drain mode')

// 6. Rollback.
await pg.exec(readFileSync(new URL('../supabase/migrations/20261110190000_wa_meta_inbox.rollback.sql', import.meta.url), 'utf8'))
eq((await pg.query(`select count(*)::int n from pg_tables where tablename='wa_meta_inbox'`)).rows[0], { n: 0 }, 'rollback removes the inbox')
await pg.close()
console.log(`WA_META_INBOX_OK ${checks} checks`)
