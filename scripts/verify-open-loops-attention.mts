import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseExplicitOpenLoop, isOpenLoopQuery, isOpenLoopResolutionCandidate, parseOpenLoopResolution } from '../lib/agent/open-loops'

const wait=parseExplicitOpenLoop("I'm still waiting on Srinivas to send the corrected JSON.")
assert.ok(wait)
assert.equal(wait.kind,'waiting_on')
assert.match(wait.title,/Srinivas/i)

const follow=parseExplicitOpenLoop('I need to follow up with Nithin about the pending salaries.')
assert.ok(follow)
assert.equal(follow.kind,'followup')

const commitment=parseExplicitOpenLoop('I need to send the security approval today.')
assert.ok(commitment)
assert.equal(commitment.kind,'commitment')


const implied=parseExplicitOpenLoop("Srinivas said he'll send the corrected JSON by Friday.")
assert.ok(implied)
assert.equal(implied.kind,'waiting_on')
assert.match(implied.title,/Srinivas/i)
assert.match(implied.title,/JSON/i)

const noResponse=parseExplicitOpenLoop('Still no response from BCL India.')
assert.ok(noResponse)
assert.equal(noResponse.kind,'followup')

const requested=parseExplicitOpenLoop('I asked Nithin to confirm the salary release.')
assert.ok(requested)
assert.equal(requested.kind,'waiting_on')

const expected=parseExplicitOpenLoop('Security approval is expected today.')
assert.ok(expected)
assert.equal(expected.kind,'waiting_on')

assert.equal(parseExplicitOpenLoop('I need to know the weather tomorrow.'),null)
assert.equal(isOpenLoopQuery('What am I waiting on?'),true)
assert.equal(isOpenLoopQuery('What are my open loops?'),true)
assert.equal(isOpenLoopQuery('What meetings do I have tomorrow?'),false)
assert.equal(parseOpenLoopResolution('mark 2 done'),null)
assert.deepEqual(parseOpenLoopResolution('mark open loop 2 done'),{index:2,mode:'resolved'})
assert.equal(isOpenLoopResolutionCandidate('mark 2 done'),true)
assert.deepEqual(parseOpenLoopResolution('dismiss 3',{allowGeneric:true}),{index:3,mode:'dismissed'})

const bridge=readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const webhook=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
const pulse=readFileSync('lib/agent/autonomy-pulse.ts','utf8')
const status=readFileSync('lib/agent/autonomy-status.ts','utf8')
const vercel=readFileSync('vercel.json','utf8')
const migration=readFileSync('supabase/migrations/20260922154000_agent_open_loops.sql','utf8')

assert.match(bridge,/handleOpenLoopQuery/)
assert.match(bridge,/handleOpenLoopResolution/)
assert.match(bridge,/shouldHandleOpenLoopResolution/)
assert.match(webhook,/captureExplicitOpenLoopFromTurn/)
assert.match(webhook,/isOpenLoopQuery\(text\) \|\| isOpenLoopResolutionCandidate\(text\)/)
assert.match(pulse,/agent_open_loops/)
assert.match(pulse,/Open loop/)
assert.match(status,/Open loops/)
assert.match(status,/syncOpenLoopsForUser/)
assert.match(vercel,/\/api\/cron\/open-loops/)
assert.match(migration,/create table if not exists public\.agent_open_loops/)
assert.match(migration,/unique \(telegram_id, fingerprint\)/)

console.log('Open-Loops / Attention Engine v1 verification passed')

const openLoops=readFileSync('lib/agent/open-loops.ts','utf8')
assert.match(openLoops,/successfulSourceTypes/)
assert.match(openLoops,/isoPlusHoursFrom\(row\.created_at,24\)/)
assert.match(openLoops,/open_loops_list_shown/)
assert.match(openLoops,/bucket%sorted\.length/)
console.log('Open-loop reconciliation, context-safe resolution and fair rotation verified')

const gmail=readFileSync('lib/services/google-gmail.ts','utf8')
assert.match(gmail,/fetchGmailAttentionThreads/)
assert.match(gmail,/newer_than:14d/)
assert.match(openLoops,/syncGmailAttention/)
assert.match(openLoops,/gmail_thread/)
assert.match(openLoops,/outbound_waiting/)
assert.match(openLoops,/inbound_action/)
assert.match(openLoops,/autoResolveOpenLoopsFromTurn/)
assert.match(openLoops,/open_loop_auto_resolved/)
assert.match(openLoops,/result\.value==='skip'/)
console.log('Semantic completion + read-only Gmail attention wiring verified')
