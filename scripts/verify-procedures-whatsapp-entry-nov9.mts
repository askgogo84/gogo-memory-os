// Same Brain 3.0: the email.follow_up procedure can start from WhatsApp, but the approval stays on the dashboard card.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { followUpReply, parseFollowUpAsk, PROCEDURE_APPROVAL_URL } from '../lib/procedures/entry.ts'

let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++ }

// 1. WhatsApp reply points to the dashboard approval and says nothing is sent.
const wa = followUpReply('waiting_approval', 'whatsapp')
ok(wa.includes(PROCEDURE_APPROVAL_URL), 'WhatsApp reply links the dashboard approval')
ok(/Nothing is sent until you approve/.test(wa), 'WhatsApp reply says nothing is sent before approval')
ok(!/card below/.test(wa), 'WhatsApp reply does not mention a card that WhatsApp cannot show')
ok(/card below/.test(followUpReply('waiting_approval')), 'dashboard reply is unchanged')
ok(/Nothing was sent/.test(followUpReply('failed', 'whatsapp')), 'failure reply never claims a send')
ok(/nothing to follow up/.test(followUpReply('completed', 'whatsapp')) && !/\bwas sent\b|\bI sent\b/.test(followUpReply('completed', 'whatsapp')), 'completed reply claims no send')

// 2. The process-message pre-filter admits everything the parser accepts (positive control) and the parser still rejects chatter.
const src = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
const m = src.match(/const procedureReply=params\.channel==='whatsapp'&&!params\.internalStep&&\(globalThis as any\)\.process\?\.env\?\.VERCEL_ENV&&\/(.+?)\/i\.test\(incomingText\)/)
ok(m, 'WhatsApp entry is gated by channel, internalStep and VERCEL_ENV, in that order')
const pre = new RegExp(m![1].replace(/\\\\/g, '\\'), 'i')
for (const t of ['follow up with Nithin on the Harbor deck', 'Follow-up with Divya', 'please send a follow up to Nithin about the invoice', 'followup on my last email from Divya']) {
  ok(parseFollowUpAsk(t), `parser accepts: ${t}`)
  ok(pre.test(t), `pre-filter admits: ${t}`)
}
for (const t of ['what did Nithin say?', 'remind me to follow up tomorrow', 'I will follow up later']) ok(!parseFollowUpAsk(t), `parser rejects: ${t}`)

// 3. The entry calls the procedure with the WhatsApp surface and an AgentActor; it never calls a send path itself.
const block = src.slice(src.indexOf('const procedureReply=params.channel'), src.indexOf("handledBy:'procedure-follow-up'"))
ok(/resolveAgentActor\(\{telegramId:String\(resolvedUser\.telegramId\)/.test(block), 'actor comes from resolveAgentActor (exact-owner checks)')
ok(/tryProcedureAsk\(actor,incomingText,'whatsapp'\)/.test(block), "procedure runs with surface 'whatsapp'")
ok(!/sendGmail|releaseApproved|resumeProcedureRun/.test(block), 'WhatsApp entry cannot send, release or resume')
ok(/\.catch\(/.test(block), 'a failure falls through to the ordinary brain')

// 4. Owner gate still lives inside tryProcedureAsk.
const entry = readFileSync(new URL('../lib/procedures/entry.ts', import.meta.url), 'utf8')
ok(/if \(!proceduresEnabledFor\(String\(actor\.legacyTelegramId\)\)\) return null/.test(entry), 'GOGO_PROCEDURES_OWNERS gate kept')

console.log(`PROCEDURES_WHATSAPP_ENTRY_OK ${checks} checks`)
