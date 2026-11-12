// The person's email switch, when off, stops a draft or a staged send asked for directly in chat (review finding on
// #1486: only the email-reading path honoured it).
import assert from 'node:assert/strict'
let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, e: unknown, m: string) => { assert.deepEqual(a, e, m); checks++ }
const { supabaseAdmin } = await import('../lib/supabase-admin')
let level: string | null = 'off', draft: any = null
const reads: string[] = [], writes: string[] = []
;(supabaseAdmin as any).from = (table: string) => {
  const f: Record<string, unknown> = {}
  const q: any = {
    select: () => q, eq: (k: string, v: unknown) => { f[k] = v; return q }, in: () => q, gt: () => q, gte: () => q, lt: () => q, not: () => q, is: () => q, or: () => q, order: () => q, limit: () => q,
    insert: () => { writes.push(table); return q }, upsert: () => { writes.push(table); return q }, update: () => { writes.push(table); return q }, delete: () => { writes.push(table); return q },
    single: async () => q.maybeSingle(),
    maybeSingle: async () => {
      reads.push(table)
      if (table === 'agent_permissions') { eq([typeof f.telegram_id, f.capability], ['string', 'email'], 'the switch is read for this person as a string id, for email'); return { data: level ? { level } : null, error: null } }
      if (table === 'users') return { data: { gmail_connected: false }, error: null }
      return { data: null, error: null }
    },
    then: (r: any) => { reads.push(table); return r({ data: table === 'followup_states' || /followup/.test(table) ? (draft ? [draft] : []) : [], error: null }) },
  }
  return q
}
const g = await import('../lib/agent/gmail-send')
const actor: any = { legacyTelegramId: '9007199254740993', userId: 'u', name: 'Owner', timezone: 'Asia/Kolkata' }
const run = async (text: string) => { reads.length = 0; writes.length = 0; return g.tryRunGmailSendCommand({ actor, text }) as Promise<any> }

// Off: a new email and a reply are both stopped before Gmail is touched or anything is stored.
for (const t of ['draft an email to divya@example.com saying the launch moved to Friday', 'email divya@example.com saying hello', 'reply to Nithin saying I will join at 5']) {
  const r = await run(t)
  if (r === null) continue // not a phrasing this command owns; nothing to stop
  ok(r.runId === 'gmail-email-off' && r.status === 'paused' && /Email is currently off/.test(r.text) && /set email autonomy to draft/.test(r.text), `email off: stopped, with the way back: ${t}`)
  ok(!reads.includes('users') && writes.length === 0, `email off: Gmail is not read and nothing is saved: ${t}`)
}
const off = await run('draft an email to divya@example.com saying the launch moved to Friday')
eq(off?.runId, 'gmail-email-off', 'the plain "draft an email to … saying …" is one of the stopped phrasings')
// Not off: the same message goes on as before (here to the "connect Gmail" answer, since the fixture has none).
level = null
let r = await run('draft an email to divya@example.com saying the launch moved to Friday')
ok(r && r.runId !== 'gmail-email-off' && reads.includes('agent_permissions'), 'switch at its default: the draft path carries on')
level = 'draft'
r = await run('draft an email to divya@example.com saying the launch moved to Friday')
ok(r && r.runId !== 'gmail-email-off', 'switch on draft: carries on')
// 12 Nov: read-only blocks drafting too, with its own wording.
level = 'read'
r = await run('draft an email to divya@example.com saying the launch moved to Friday')
ok(r?.runId === 'gmail-email-off' && /read-only/.test(r.text) && /set email autonomy to draft/.test(r.text), 'email read-only: stopped, with the way back')
// Messages that are not an email draft or send are not answered with the switch, and it is not even read.
level = 'off'
for (const t of ['remind me to call Divya at 5', 'what is on my calendar tomorrow', 'send it']) {
  r = await run(t)
  ok(r === null && !reads.includes('agent_permissions'), `not an email draft or a pending send: untouched, switch not read: ${t}`)
}
// Wiring: each of the three places that draft or stage a send checks first.
const { readFileSync } = await import('node:fs')
const src = readFileSync(new URL('../lib/agent/gmail-send.ts', import.meta.url), 'utf8')
eq((src.match(/\{const block=await emailBlock\(params\.actor\);if\(block\)return emailBlockedResult\(block\)\}/g) || []).length, 3, 'send-it, new email and reply each stop when email is off')
const sendIt = src.indexOf("if(/^(?:send\\s+it|send\\s+this\\s+reply)$/i.test(raw)){")
ok(sendIt > 0 && src.indexOf('emailBlock(params.actor)', sendIt) < src.indexOf('stageApproval(params.actor,state.payload.draft', sendIt), '"send it" is stopped before an approval is staged')
const compose = src.indexOf('const compose=parseGmailComposeCommand(raw)')
ok(src.indexOf('emailBlock(params.actor)', compose) < src.indexOf("saveFollowupState(params.actor.legacyTelegramId,'gmail_reply_draft'", compose), 'a new email is stopped before a draft is stored')
// The reply phrasing is exercised for real, and an approved send is not carried out once email is off.
level = 'off'
r = await run('reply to Nithin email saying ok')
eq(r?.runId, 'gmail-email-off', 'a reply is stopped')
const exec = src.indexOf('export async function executeApprovedGmailSend')
const gate = src.indexOf('{const block=await emailBlock(params.actor);if(block)return {runId:params.runId', exec)
ok(exec > 0 && gate > src.indexOf('assertApprovalBinding({', exec) && gate < src.indexOf("gmailAccess(params.actor,{requireSend:true})", exec) && gate < src.indexOf("update({status:'running',summary:'Sending approved Gmail reply.'", exec), 'an approved send checks the switch after the approval is verified and before Gmail is read or the run is claimed')
ok(/so I have not sent this email/.test(src), 'and says it was not sent')
// The way back is not intercepted: an autonomy command is not an email draft.
for (const t of ['set email autonomy to draft', 'set email autonomy to off']) { r = await run(t); ok(r === null && !reads.includes('agent_permissions'), `the recovery command passes through: ${t}`) }
// Review 12 Nov: the procedure follow-up is gated before a run starts and again at send time (fail closed there).
{ const pe = readFileSync(new URL('../lib/procedures/entry.ts', import.meta.url), 'utf8')
  ok(pe.indexOf('emailDraftBlock(actor.legacyTelegramId)') > 0 && pe.indexOf('emailDraftBlock(actor.legacyTelegramId)') < pe.indexOf('startProcedureRun({'), 'a follow-up is not started while email is off or read-only')
  const pio = readFileSync(new URL('../lib/procedures/io.ts', import.meta.url), 'utf8')
  const at = pio.indexOf("=== 'email.follow_up:send'")
  ok(at > 0 && pio.indexOf('emailDraftBlock', at) < pio.indexOf('gmailAccess(actor', at) && /catch\(\(\) => 'error' as const\)\n      if \(block\) throw/.test(pio), 'an approved follow-up checks again before Gmail and fails closed')
  ok(/error:'I couldn’t check your email setting just now/.test(src), 'a settings read failure says so, not "email is off"') }
console.log(`EMAIL_SWITCH_OK ${checks} checks`)
