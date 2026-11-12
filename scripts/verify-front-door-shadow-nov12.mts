// Front door step 1 (owner-approved 12 Nov, "Gogo front door: one smart reply"): shadow comparison only. For owners in
// GOGO_BRAIN_FRONT_DOOR_SHADOW, after the pipeline replied, the loop writes the reply it would have sent and both are
// logged side by side. It never sends, never prepares, runs no web search and has no send dependency at all.
// Synthetic fixtures only (placeholder number, sample names); the model is a scripted fake.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key-0123456789'
process.env.ANTHROPIC_API_KEY ||= 'test'
process.env.OPENAI_API_KEY ||= 'test'
const brain = await import('../lib/agent/brain.ts')
const loop = await import('../lib/agent/brain-loop.ts')
const TL = await import('../lib/agent/brain-loop-tools.ts')
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const PHONE = '919000000001', ON = { GOGO_BRAIN_FRONT_DOOR_SHADOW: '9000000001' }
const AT = Date.parse('2026-11-12T07:00:00Z'), iso = (ms: number) => new Date(AT + ms).toISOString()
const P = { phone: PHONE, telegramId: 9000000001, text: 'Plan dinner for Divya\'s birthday next Saturday for 8 people', name: 'Divya', userId: 'u1', whatsappId: PHONE }
const ctxWith = (turns: any[]) => ({ turns, trackedFlights: [], sections: {}, name: 'Divya', timezone: 'Asia/Kolkata' })
const PIPE = 'Saved a draft event: Divya\'s birthday dinner, Sat, 8 people.'
const BEFORE = [{ role: 'user', content: 'hi', createdAt: iso(-60_000) }, { role: 'assistant', content: 'Hello!', createdAt: iso(-59_000) }]
const NORMAL = [...BEFORE, { role: 'user', content: P.text, createdAt: iso(200) }, { role: 'assistant', content: PIPE, createdAt: iso(900) }]
const RESULT = { final: { kind: 'reply', text: 'Which area should I look in for Saturday?' }, prepared: [], steps: [{ tool: 'events_list', klass: 'read', executed: true, ok: true, ms: 5 }, { tool: 'web_search', klass: 'read', executed: true, ok: true, ms: 1 }, { tool: 'event_draft', klass: 'prepare', executed: false, ok: true, ms: 0 }], turns: 2, ms: 900, usd: 0.004, usage: { input: 1000, output: 80, cacheRead: 0, cacheCreation: 0 }, model: 'claude-sonnet-5-5', stop: 'final' }
function harness(over: any = {}) {
  const st: any = { runs: [], started: [], finished: [], jobs: [], loads: [] }
  const deps = { env: ON, now: () => AT, settle: async () => {}, secret: async () => false, defer: async (j: any) => { st.jobs.push(j) }, countToday: async () => 0,
    start: async (row: any) => { st.started.push(row); return 'row-1' }, finish: async (id: string, row: any) => { st.finished.push({ id, row }) },
    loadContext: async (a: any) => { st.loads.push(a); return ctxWith(over.turns || NORMAL) },
    run: async (a: any) => { st.runs.push(a); return RESULT }, tools: [], ...over.deps }
  return { st, deps, go: async (p: any = P) => { await brain.scheduleFrontDoorShadow(p, deps as any); for (const j of st.jobs.splice(0)) await j() } }
}

// Off unless the owner is listed; other numbers never run.
for (const env of [{}, { GOGO_BRAIN_FRONT_DOOR_SHADOW: '' }, { GOGO_BRAIN_FRONT_DOOR_SHADOW: '919999999999' }]) { const h = harness({ deps: { env } }); await h.go(); eq(h.st.runs.length + h.st.started.length, 0, `off: ${JSON.stringify(env)}`) }
ok(brain.frontDoorShadowFor('9000000001', ON) && brain.frontDoorShadowFor('+91 90000 00001', ON), 'the owner is matched by digits, with or without 91')
ok(!brain.frontDoorShadowFor('', ON), 'an empty phone never matches')
// Never alongside the existing brain-loop passes: one comparison per message.
for (const k of ['GOGO_BRAIN_LOOP_USERS', 'GOGO_BRAIN_LOOP_LIVE_USERS']) { const h = harness({ deps: { env: { ...ON, [k]: '9000000001' } } }); await h.go(); eq(h.st.started.length, 0, `skipped when also in ${k}`) }
// Fixed commands keep going to their handler and are not compared.
for (const t of ['APPROVE', 'reject', 'YES', 'book it', 'send it', '2', 'forget my travel details', 'set email autonomy to off', '  ']) { const h = harness(); await h.go({ ...P, text: t }); eq(h.st.started.length, 0, `fixed command skipped: ${JSON.stringify(t)}`) }
ok(!brain.FRONT_DOOR_FIXED.test('book it for Saturday at Toit'), 'a longer sentence is still compared')
// Messages that may carry a secret are never sent to the model or logged.
for (const t of ['482913', '4829 13', '4111 1111 1111 1111', 'my account 123456789012']) { const h = harness(); await h.go({ ...P, text: t }); eq(h.st.started.length, 0, `secret-shaped skipped: ${t}`) }
{ const h = harness({ deps: { secret: async (t: string) => /otp/i.test(t) } }); await h.go({ ...P, text: 'my otp is 4829' }); eq(h.st.started.length, 0, 'the secret guard is honoured') }
{ const pm = await import('../lib/bot/process-message.ts'); ok(pm.secretDeclaration('my otp is 482913') === 'otp' && pm.secretDeclaration('password: hunter22') === 'password', 'the default guard is the existing secretDeclaration') }
// Unsafe ids never run.
for (const id of [0, -9000000001, 2 ** 60, 1.5]) { const h = harness(); await h.go({ ...P, telegramId: id }); eq(h.st.started.length, 0, `unsafe id ${id}`) }

// The real pass: the loop answers as if first, in SHADOW mode, and both replies are logged.
{ const h = harness(); await h.go()
  eq(h.st.started.length, 1, 'a started row is written before the run (the cap counts it)')
  eq(h.st.runs.length, 1, 'one loop pass')
  const a = h.st.runs[0]
  eq(a.mode, 'shadow', 'the loop runs in shadow mode')
  ok(!('alreadyReplied' in a), 'the loop is not told a reply went out: it writes the first reply')
  eq(a.ctx.turns.map((t: any) => t.content), ['hi', 'Hello!'], 'only turns before the message are history')
  eq(a.text, P.text, 'the message is the person\'s own text')
  eq(a.actor.legacyTelegramId, P.telegramId, 'the actor is the session\'s owner')
  eq(h.st.loads[0].decisionTrace, false, 'the context load writes no duplicate decision trace')
  const m = h.st.finished[0].row.metadata_json
  eq(h.st.finished[0].id, 'row-1', 'the same row is completed')
  eq(m.status, 'compared', 'marked compared')
  eq(m.pipeline_reply, PIPE, 'the pipeline reply is logged')
  ok(/Which area/.test(m.loop_reply), 'the loop reply is logged')
  eq(m.would_do, ['web_search', 'event_draft'], 'searches and prepare calls are listed as would-do')
  ok(!JSON.stringify(h.st.started[0]).includes('Divya') && !JSON.stringify(h.st.finished[0]).includes('next Saturday for 8'), 'the message text itself is not stored')
  eq(m.message_chars, P.text.length, 'only its length is') }
// Pairing is by time, so rewrites, placeholders and several replies still pair correctly.
{ const h = harness({ turns: [...BEFORE, { role: 'user', content: 'Plan the birthday event (rewritten by a handler)', createdAt: iso(300) }, { role: 'assistant', content: 'Part 1', createdAt: iso(800) }, { role: 'assistant', content: 'Part 2', createdAt: iso(5000) }] }); await h.go()
  eq(h.st.runs[0].ctx.turns.length, 2, 'rewritten text: history still excludes this message')
  eq(h.st.finished[0].row.metadata_json.pipeline_reply, 'Part 1\n\nPart 2', 'several replies are logged together')
  eq(h.st.finished[0].row.metadata_json.pipeline_messages, 2, 'and counted') }
// Not comparable: nothing saved yet, only the user turn, a repeated earlier message, or turns without times.
for (const [why, turns, reason] of [
  ['no reply saved', [...BEFORE, { role: 'user', content: P.text, createdAt: iso(200) }], 'no_reply'],
  ['nothing saved', BEFORE, 'no_user_turn'],
  ['repeated earlier message', [{ role: 'user', content: P.text, createdAt: iso(-90_000) }, { role: 'assistant', content: 'old answer', createdAt: iso(-89_000) }], 'no_user_turn'],
  ['no times', [{ role: 'user', content: P.text }, { role: 'assistant', content: PIPE }], 'no_times'],
] as const) { const h = harness({ turns }); await h.go(); eq(h.st.runs.length, 0, `${why}: the loop does not run`); eq(h.st.finished[0]?.row.metadata_json.reason, reason, `${why}: logged as ${reason}`) }
// Review round 2: a slow previous reply stays in history; a second message in the window is not comparable.
{ const h = harness({ turns: [...BEFORE, { role: 'user', content: 'earlier question', createdAt: iso(-3000) }, { role: 'assistant', content: 'slow earlier answer', createdAt: iso(1200) }, { role: 'user', content: P.text, createdAt: iso(1500) }, { role: 'assistant', content: PIPE, createdAt: iso(2500) }] }); await h.go()
  eq(h.st.finished[0].row.metadata_json.pipeline_reply, PIPE, 'a slow reply to the previous message is not counted as this one')
  eq(h.st.runs[0].ctx.turns.map((x: any) => x.content).slice(-2), ['earlier question', 'slow earlier answer'], 'it stays in history') }
{ const h = harness({ turns: [...NORMAL, { role: 'user', content: 'and also book a cab', createdAt: iso(2000) }, { role: 'assistant', content: 'Cab noted', createdAt: iso(2600) }] }); await h.go()
  eq(h.st.runs.length, 0, 'a second message in the window: the loop does not run'); eq(h.st.finished[0].row.metadata_json.reason, 'second_message', 'logged as second_message') }
{ const r = brain.frontDoorPair([{ role: 'user', content: 'x', createdAt: iso(100) }, { role: 'assistant', content: 'y' }] as any, AT); eq(r, null, 'a turn without a time: no pair') }
for (const t of ['482913 is the code', 'code 4829', 'pin 4321', 'cvv 123', 'login: divya pass Nithin#99']) { const h = harness(); await h.go({ ...P, text: t }); eq(h.st.started.length, 0, `code-word message skipped: ${t}`) }
{ const h = harness(); await h.go({ ...P, text: 'Can you find a good place for the team dinner and send me the booking code for the venue once Divya confirms which date works for everyone' }); eq(h.st.started.length, 1, 'a long ordinary sentence with a code word and no number is still compared') }
// Forwarded messages carry the forwarded note.
{ const h = harness(); await h.go({ ...P, forwarded: true }); ok(Object.values(h.st.runs[0].ctx.sections).flat().some((x: any) => /FORWARDED/.test(String(x))), 'forwarded note added') }
// Daily cap; a count error counts as over the cap; no started row means no run.
{ const h = harness({ deps: { countToday: async () => 60 } }); await h.go(); eq(h.st.runs.length, 0, 'default cap 60') }
{ const h = harness({ deps: { countToday: async () => 3, env: { ...ON, GOGO_BRAIN_FRONT_DOOR_DAILY: '3' } } }); await h.go(); eq(h.st.runs.length, 0, 'cap from the setting') }
{ const h = harness({ deps: { countToday: async () => Number.POSITIVE_INFINITY } }); await h.go(); eq(h.st.runs.length, 0, 'a count read error stops the pass') }
{ const h = harness({ deps: { start: async () => null } }); await h.go(); eq(h.st.runs.length, 0, 'a failed started row stops the pass (the cap must count it)') }
eq(brain.FRONT_DOOR_DAILY({ GOGO_BRAIN_FRONT_DOOR_DAILY: 'lots' }), 60, 'a bad cap falls back to 60')
// Secrets in the pipeline reply are redacted before they are logged.
{ const h = harness({ turns: [...BEFORE, { role: 'user', content: P.text, createdAt: iso(200) }, { role: 'assistant', content: 'Your api key: sk-ant-abcdefghijklmnopqrstuvwxyz0123456789', createdAt: iso(800) }] }); await h.go()
  ok(!/sk-ant-abcdefghijklmnopqrstuvwxyz0123456789/.test(JSON.stringify(h.st.finished)), 'a labelled key is redacted before it is logged') }
// A failure inside the pass is swallowed: nothing sent, nothing thrown to the webhook.
{ const h = harness({ deps: { run: async () => { throw new Error('model down') } } }); await h.go(); eq(h.st.finished.length, 0, 'a failed pass throws nothing') }
// With the production tool list: searches are stubbed (no provider call) and the prepare tool never runs.
{ let searched = 0, saved = 0
  const real = TL.firstSliceTools({ search: async () => { searched++; return [] }, saveDraft: async () => { saved++ }, listEvents: async () => [] } as any)
  const h = harness({ deps: { tools: real, run: async (a: any) => { h.st.runs.push(a)
    const ws = a.tools.find((t: any) => t.name === 'web_search'), vc = a.tools.find((t: any) => t.name === 'venue_contact')
    eq(await ws.run(a.actor, { query: 'Toit Indiranagar group booking' }, { verified: new Set(), prepared: [] }), brain.FRONT_DOOR_SEARCH_STUB, 'web_search answers from the stub')
    eq(await vc.run(a.actor, { venue: 'Toit Indiranagar' }, { verified: new Set(), prepared: [] }), brain.FRONT_DOOR_SEARCH_STUB, 'venue_contact answers from the stub')
    return RESULT } } }); await h.go()
  eq(searched, 0, 'no search provider is called')
  const calls: any[] = []; let i = 0
  const script = [[{ type: 'tool_use', id: 't1', name: 'venue_enquiry_draft', input: { venue: 'Toit', occasion: 'birthday', date: '2026-12-20', time: '19:00', people: 8 } }], [{ type: 'tool_use', id: 't2', name: 'reply', input: { text: 'done' } }]]
  const client = { messages: { create: async (req: any) => { calls.push(req); return { content: script[Math.min(i++, script.length - 1)], usage: { input_tokens: 10, output_tokens: 5 } } } } } as any
  const r = await loop.runBrainLoop({ actor: h.st.runs[0].actor, text: P.text, ctx: ctxWith([]) as any, tools: h.st.runs[0].tools, client, model: 'claude-haiku-5-5', mode: 'shadow' })
  ok(saved === 0 && r.steps.some(s => s.tool === 'venue_enquiry_draft' && !s.executed), 'the enquiry draft (a prepare tool) is planned, never run') }

// Code shape: the pass has no send path, runs only in shadow mode, and the webhook schedules it early with after().
const src = readFileSync(new URL('../lib/agent/brain.ts', import.meta.url), 'utf8')
const body = src.slice(src.indexOf('export async function scheduleFrontDoorShadow'), src.indexOf('/** How many approval cards are waiting'))
ok(body.length > 500 && !/sendWhatsApp|deps\.send|conversations'\)\.insert/.test(body), 'no send and no conversation write in the pass')
ok(/mode: 'shadow' \}\)/.test(body) && !/mode: 'live'|goLive/.test(body), 'the loop is called in shadow mode only')
ok(/m\.after\(pass\)\)\.catch\(\(\) => \{\}\)/.test(body), 'outside after() nothing runs')
ok(/\(p as any\)\.decisionTrace !== false\) void import\('\.\/decision-trace'\)/.test(src), 'loadBrainContext honours decisionTrace:false')
const hook = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
const hi = hook.indexOf('scheduleFrontDoorShadow('), fw = hook.indexOf("const forwardedMessage = String(formData.get('Forwarded')")
ok(fw > 0 && hi > fw && hi < hook.indexOf('lib/memory/front-door', fw), 'the webhook schedules it right after forwarded is known, before any handler can return')
ok(/process\.env\.GOGO_BRAIN_FRONT_DOOR_SHADOW\) await import/.test(hook) && hook.split('scheduleFrontDoorShadow(').length === 2, 'only when the setting exists, and once')
console.log(`FRONT_DOOR_SHADOW_OK ${checks} checks`)
