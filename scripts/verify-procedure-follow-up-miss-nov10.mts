// 10 Nov live test: "follow up with Nithin on the Harbor deck" with no such Gmail thread replied
// "I couldn't prepare that follow-up (running)" — the read kept retrying a failure that cannot change.
import assert from 'node:assert/strict'
import { followUpReply, PROCEDURE_APPROVAL_URL } from '../lib/procedures/entry.ts'
import { readFailureIsFinal } from '../lib/procedures/runtime.ts'
import { createRun, advance } from '../lib/procedures/engine.ts'
import { EMAIL_FOLLOW_UP } from '../lib/procedures/templates.ts'
let n = 0; const ok = (c: unknown, m: string) => { assert.ok(c, m); n++ }

// 1. Which read failures are final.
for (const e of ['thread_not_found', 'thread_ambiguous', 'gmail_not_connected', 'gmail_consent_missing', 'gmail_owner_invalid']) ok(readFailureIsFinal(e), `${e} is final`)
for (const e of ['gmail_token_unavailable', 'gmail_read_unavailable', 'fetch failed', 'timeout', '']) ok(!readFailureIsFinal(e), `${e || '(empty)'} still retries`)

// 2. Engine: a final read failure skips the retry budget and takes the fail edge; a normal one retries (positive control).
const now = () => '2026-11-10T04:40:00.000Z'
const anyAdvance = advance as any
let run = createRun(EMAIL_FOLLOW_UP, 'r1', { target: 'Nithin on the Harbor deck' }, now)
run = anyAdvance(EMAIL_FOLLOW_UP, run, { kind: 'start' }, now) ?? run
const atRead = run.current === 'read_thread' ? run : anyAdvance(EMAIL_FOLLOW_UP, run, { kind: 'tick' }, now)
ok(atRead.current === 'read_thread', `run is at read_thread (was ${atRead.current})`)
const finalFail = anyAdvance(EMAIL_FOLLOW_UP, atRead, { kind: 'read_failed', node: 'read_thread', error: 'thread_not_found', final: true }, now)
ok(finalFail.status === 'failed' && finalFail.error === 'thread_not_found', `final failure ends the run with its error (status ${finalFail.status}, error ${finalFail.error})`)
const retried = anyAdvance(EMAIL_FOLLOW_UP, atRead, { kind: 'read_failed', node: 'read_thread', error: 'fetch failed' }, now)
ok(retried.status === 'running' && retried.current === 'read_thread', 'a transient failure still retries')

// 3. Replies say what happened and never claim a send.
const nf = followUpReply('failed', 'whatsapp', 'thread_not_found', 'Nithin on the Harbor deck')
ok(/couldn't find an email thread with Nithin on the Harbor deck/.test(nf) && /Nothing was sent/.test(nf), 'no-thread reply names the target and says nothing was sent')
ok(!/\(running\)|\(failed\)/.test(nf), 'no raw status in the reply')
ok(/more than one/.test(followUpReply('failed', 'whatsapp', 'thread_ambiguous', 'Divya')), 'ambiguous reply')
ok(/Connect Gmail/.test(followUpReply('failed', 'whatsapp', 'gmail_not_connected')), 'not-connected reply')
ok(/still reading/.test(followUpReply('running', 'whatsapp')) && /Nothing has been sent/.test(followUpReply('running', 'whatsapp')), 'running reply is honest')
ok(followUpReply('waiting_approval', 'whatsapp').includes(PROCEDURE_APPROVAL_URL), 'approval reply unchanged')
console.log(`PROCEDURE_FOLLOW_UP_MISS_OK ${n} checks`)
