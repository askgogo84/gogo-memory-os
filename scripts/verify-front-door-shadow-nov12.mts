// Front door step 1 (owner-approved 12 Nov, "Gogo front door: one smart reply"): shadow comparison only. For owners in
// GOGO_BRAIN_FRONT_DOOR_SHADOW, after the pipeline replied, the loop writes the reply it would have sent and both are
// logged side by side. It never sends, never prepares and has no send dependency at all. The model is a scripted fake.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-service-role-key-0123456789'
process.env.ANTHROPIC_API_KEY ||= 'test'
const brain = await import('../lib/agent/brain.ts')
const loop = await import('../lib/agent/brain-loop.ts')
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const ON = { GOGO_BRAIN_FRONT_DOOR_SHADOW: '8884501501' }
const P = { phone: '918884501501', telegramId: 884501501, text: 'Plan dinner for Divya\'s birthday next Saturday for 8 people', name: 'Goverdhan M D', userId: 'u1', whatsappId: '918884501501' }
const ctxWith = (turns: any[]) => ({ turns, trackedFlights: [], sections: {}, name: 'Goverdhan M D', timezone: 'Asia/Kolkata' })
const PIPE = 'Saved a draft event: Divya\'s birthday dinner, Sat, 8 people.'
const use = (name: string, input: any) => ({ type: 'tool_use', id: `t${Math.random()}`, name, input })
function harness(over: any = {}) {
  const st: any = { runs: [], saved: [], jobs: [] }
  const deps = { env: ON, defer: async (j: any) => { st.jobs.push(j) }, countToday: async () => 0, save: async (row: any) => { st.saved.push(row) },
    loadContext: async () => ctxWith([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello!' }, { role: 'user', content: P.text }, { role: 'assistant', content: PIPE }]),
    run: async (a: any) => { st.runs.push(a); return over.result || { final: { kind: 'reply', text: 'Booked nothing yet. Which area should I look in for Saturday?' }, prepared: [], steps: [{ tool: 'events_list', klass: 'read', executed: true, ok: true, ms: 5 }, { tool: 'event_draft', klass: 'prepare', executed: false, ok: true, ms: 0 }], turns: 2, ms: 900, usd: 0.004, usage: { input: 1000, output: 80, cacheRead: 0, cacheCreation: 0 }, model: 'claude-sonnet-5-5', stop: 'final' } },
    tools: [], ...over.deps }
  return { st, deps, go: async (p: any = P) => { await brain.scheduleFrontDoorShadow(p, deps as any); for (const j of st.jobs.splice(0)) await j() } }
}

// Off unless the owner is listed; other numbers never run.
for (const env of [{}, { GOGO_BRAIN_FRONT_DOOR_SHADOW: '' }, { GOGO_BRAIN_FRONT_DOOR_SHADOW: '919999999999' }]) { const h = harness({ deps: { env } }); await h.go(); eq(h.st.runs.length + h.st.saved.length, 0, `off: ${JSON.stringify(env)}`) }
ok(brain.frontDoorShadowFor('8884501501', ON) && brain.frontDoorShadowFor('+91 88845 01501', ON), 'the owner is matched by digits, with or without 91')
ok(!brain.frontDoorShadowFor('', ON), 'an empty phone never matches')
// Fixed commands keep going to their handler and are not compared.
for (const t of ['APPROVE', 'reject', 'YES', 'book it', 'send it', '2', 'forget my travel details', 'set email autonomy to off', '  ']) { const h = harness(); await h.go({ ...P, text: t }); eq(h.st.runs.length, 0, `fixed command skipped: ${JSON.stringify(t)}`) }
ok(!brain.FRONT_DOOR_FIXED.test('book it for Saturday at Toit'), 'a longer sentence is still compared')
// Unsafe ids never run.
for (const id of [0, -884501501, 2 ** 60, 1.5]) { const h = harness(); await h.go({ ...P, telegramId: id }); eq(h.st.runs.length, 0, `unsafe id ${id}`) }

// The real pass: the loop answers as if first, in SHADOW mode, and both replies are logged.
{ const h = harness(); await h.go()
  eq(h.st.runs.length, 1, 'one loop pass')
  const a = h.st.runs[0]
  eq(a.mode, 'shadow', 'the loop runs in shadow mode (read tools only)')
  ok(!('alreadyReplied' in a), 'the loop is not told a reply went out: it writes the first reply')
  eq(a.ctx.turns.map((t: any) => t.content), ['hi', 'Hello!'], 'the answered pair is taken out of the history')
  eq(a.text, P.text, 'the message is the person\'s own text')
  eq(a.actor.legacyTelegramId, P.telegramId, 'the actor is the session\'s owner')
  eq(h.st.saved.length, 1, 'one row logged')
  const row = h.st.saved[0], m = row.metadata_json
  eq(row.event_type, 'brain_front_door_shadow', 'its own event type and daily count')
  eq(row.telegram_id, '884501501', 'logged for the owner')
  eq(m.pipeline_reply, PIPE, 'the pipeline reply is logged')
  ok(m.pipeline_reply_found === true, 'and marked found')
  ok(/Which area/.test(m.loop_reply), 'the loop reply is logged')
  eq(m.would_prepare, ['event_draft'], 'what it would have prepared is listed, not done')
  eq(m.mode, 'front_door_shadow', 'mode recorded')
  ok(/Divya/.test(m.message), 'the message is logged with the pair') }
// The pipeline reply is not saved yet: the trailing user turn is still taken out, and the row says not found.
{ const h = harness({ deps: { loadContext: async () => ctxWith([{ role: 'user', content: P.text }]) } }); await h.go()
  eq(h.st.runs[0].ctx.turns, [], 'the latest message is not repeated in the history')
  ok(h.st.saved[0].metadata_json.pipeline_reply_found === false, 'marked not found') }
// Forwarded messages carry the forwarded note.
{ const h = harness(); await h.go({ ...P, forwarded: true }); ok(Object.values(h.st.runs[0].ctx.sections).flat().some((x: any) => /FORWARDED/.test(String(x))), 'forwarded note added') }
// Daily cap, and a count read error counts as "over the cap".
{ const h = harness({ deps: { countToday: async () => 60 } }); await h.go(); eq(h.st.runs.length, 0, 'default cap 60') }
{ const h = harness({ deps: { countToday: async () => 3, env: { ...ON, GOGO_BRAIN_FRONT_DOOR_DAILY: '3' } } }); await h.go(); eq(h.st.runs.length, 0, 'cap from the setting') }
eq(brain.FRONT_DOOR_DAILY({ GOGO_BRAIN_FRONT_DOOR_DAILY: 'lots' }), 60, 'a bad cap falls back to 60')
// Secrets in either reply are redacted before they are logged.
{ const h = harness({ deps: { loadContext: async () => ctxWith([{ role: 'user', content: P.text }, { role: 'assistant', content: 'Your OTP is 482913 and key sk-ant-abcdefghijklmnopqrstuvwxyz0123456789' }]) } }); await h.go()
  ok(!/sk-ant-abcdefghijklmnopqrstuvwxyz0123456789/.test(JSON.stringify(h.st.saved[0])), 'a key-shaped secret is not logged') }
// A failure inside the pass is swallowed: nothing is sent, nothing thrown to the webhook.
{ const h = harness({ deps: { run: async () => { throw new Error('model down') } } }); await h.go(); eq(h.st.saved.length, 0, 'a failed pass logs no row and throws nothing') }

// Code shape: the pass has no send path, runs only in shadow mode, and the webhook schedules it with after().
const src = readFileSync(new URL('../lib/agent/brain.ts', import.meta.url), 'utf8')
const body = src.slice(src.indexOf('export async function scheduleFrontDoorShadow'), src.indexOf('/** How many approval cards are waiting'))
ok(body.length > 500 && !/sendWhatsApp|send\?:|deps\.send|conversations'\)\.insert/.test(body), 'no send and no conversation write in the pass')
ok(/mode: 'shadow' \}\)/.test(body) && !/mode: 'live'|goLive/.test(body), 'the loop is called in shadow mode only')
ok(/m\.after\(pass\)\)\.catch\(\(\) => \{\}\)/.test(body), 'outside after() nothing runs')
const hook = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
const hi = hook.indexOf('scheduleFrontDoorShadow(')
ok(hi > 0 && hi < hook.indexOf('let eventsCheckedFor') && /process\.env\.GOGO_BRAIN_FRONT_DOOR_SHADOW\) await import/.test(hook), 'the webhook schedules it only when the setting exists')
// The loop itself still refuses prepare and act tools in shadow (unchanged rule, checked here end to end).
{ const calls: any[] = []; let i = 0
  const script = [[use('event_draft', { name: 'x' })], [use('reply', { text: 'done' })]]
  const client = { messages: { create: async (req: any) => { calls.push(req); return { content: script[Math.min(i++, script.length - 1)], usage: { input_tokens: 10, output_tokens: 5 } } } } } as any
  let ran = false
  const tools = [{ name: 'event_draft', klass: 'prepare', description: 'd', input_schema: { type: 'object', properties: {} }, run: async () => { ran = true; return 'saved' } }] as any
  const r = await loop.runBrainLoop({ actor: { userId: 'u1', legacyTelegramId: 884501501, whatsappId: '918884501501', name: '', timezone: 'Asia/Kolkata' } as any, text: P.text, ctx: ctxWith([]) as any, tools, client, model: 'claude-haiku-5-5', mode: 'shadow' })
  ok(!ran && r.steps.some(s => s.tool === 'event_draft' && !s.executed), 'a prepare tool is planned, not run, in shadow') }
console.log(`FRONT_DOOR_SHADOW_OK ${checks} checks`)
