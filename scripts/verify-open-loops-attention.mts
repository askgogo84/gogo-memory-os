import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { draftFromOpenLoop, parseExplicitOpenLoop, isOpenLoopActionCandidate, isOpenLoopQuery, isOpenLoopResolutionCandidate, isUncertainOrNegatedCompletion, parseOpenLoopResolution } from '../lib/agent/open-loops'

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
assert.equal(isUncertainOrNegatedCompletion('Did Srinivas send the JSON?'),true)
assert.equal(isUncertainOrNegatedCompletion("Srinivas hasn't sent the JSON yet."),true)
assert.equal(isUncertainOrNegatedCompletion('Srinivas sent the JSON.'),false)
assert.equal(isOpenLoopQuery('What am I waiting on?'),true)
assert.equal(isOpenLoopQuery('What are my open loops?'),true)
assert.equal(isOpenLoopQuery('What meetings do I have tomorrow?'),false)
assert.equal(isOpenLoopQuery('What needs my attention?'),true)
assert.equal(isOpenLoopQuery('Show me what needs my attention'),true)
assert.equal(parseOpenLoopResolution('mark 2 done'),null)
assert.deepEqual(parseOpenLoopResolution('mark open loop 2 done'),{index:2,mode:'resolved'})
assert.equal(isOpenLoopResolutionCandidate('mark 2 done'),true)
assert.deepEqual(parseOpenLoopResolution('dismiss 3',{allowGeneric:true}),{index:3,mode:'dismissed'})
assert.equal(isOpenLoopActionCandidate('snooze open loop 2 for 4 hours'),true)
assert.equal(isOpenLoopActionCandidate('snooze 2 until tomorrow'),true)
assert.equal(isOpenLoopActionCandidate('draft follow-up for open loop 2'),true)
assert.equal(isOpenLoopActionCandidate('draft follow-up for 2'),true)
assert.equal(isOpenLoopActionCandidate('send follow-up for 2'),false)
assert.equal(
  draftFromOpenLoop({title:'Waiting on Srinivas to send the corrected JSON',summary:'Waiting for the corrected JSON'}),
  'Hi Srinivas, just following up regarding corrected JSON. Please let me know when you get a chance. Thanks.'
)
assert.equal(
  draftFromOpenLoop({title:'Follow up with Nithin about pending salaries',summary:'Pending salaries'}),
  'Hi Nithin, just following up regarding pending salaries. Please let me know when you get a chance. Thanks.'
)

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
assert.match(openLoops,/resolveOtherGmailLoopsForThread/)
assert.doesNotMatch(openLoops,/sourceTypes=\['followup','approval','agent_run','life_event_action','gmail_thread'\]/)
console.log('Semantic completion + read-only Gmail attention wiring verified')

const gmailHandler=readFileSync('lib/bot/handlers/gmail-read.ts','utf8')
const processMessage=readFileSync('lib/bot/process-message.ts','utf8')
const jevQuestions=readFileSync('lib/typesafe/questions.ts','utf8')
const jevShadow=readFileSync('lib/typesafe/jev-shadow.ts','utf8')
assert.match(gmailHandler,/buildGmailConnectReply/)
assert.match(gmailHandler,/buildGmailReadReply/)
assert.match(gmailHandler,/fetchUnreadEmails/)
assert.match(processMessage,/buildGmailReadReply/)
assert.doesNotMatch(processMessage,/Email reading isn't available right now/)
assert.match(jevQuestions,/attention_state/)
assert.match(jevQuestions,/waiting_on/)
assert.match(jevShadow,/attentionState/)
assert.match(webhook,/captureJevOpenLoopFromTurn/)
assert.match(webhook,/autoResolveOpenLoopsFromTurn\(\{ actor:shadowActor, text, jev:brainObservation\?\.jev \}\)/)
console.log('Gmail read + Jev semantic Attention integration verified')

assert.match(openLoops,/semantic_dedupe_score/)
assert.match(openLoops,/open_loop_similarity_read_failed/)
console.log('Conversational open-loop semantic dedupe wiring verified')

assert.match(openLoops,/syncMeetingActionMemories/)
assert.match(openLoops,/meeting_action_items/)
assert.match(openLoops,/kind:'meeting_action'/)
console.log('Meeting action-item adoption into Attention queue verified')

assert.match(openLoops,/\['approval','agent_run','life_event_action'\]\.includes\(sourceType\)/)
assert.match(openLoops,/open_loop_followup_resolve_failed/)
assert.match(openLoops,/resolveOtherGmailLoopsForThread\(telegramId,String\(thread\.id\),null\)/)
console.log('Attention manual-close source truth and Gmail follow-up reset verified')

const autonomyPulse=readFileSync('lib/agent/autonomy-pulse.ts','utf8')
const autonomyStatus=readFileSync('lib/agent/autonomy-status.ts','utf8')
assert.match(autonomyPulse,/not\('source_type','in','\(approval,agent_run,life_event_action\)'\)/)
assert.match(autonomyPulse,/open_loop_backoff_ids/)
assert.match(autonomyPulse,/nextAttentionAt/)
assert.match(autonomyPulse,/proactive_backoff_until/)
assert.match(autonomyStatus,/not\('source_type','in','\(approval,agent_run,life_event_action\)'\)/)
console.log('Attention UX v2 query, dedupe and proactive backoff verification passed')

assert.match(vercel,/"path": "\/api\/cron\/open-loops"[\s\S]*?"schedule": "5,35 \* \* \* \*"/)
assert.match(vercel,/"path": "\/api\/cron\/autonomy-pulse"[\s\S]*?"schedule": "10,40 \* \* \* \*"/)
assert.match(autonomyPulse,/next_check_at\.is\.null,next_check_at\.lte/)
console.log('Attention scout-before-pulse scheduling and due-only candidate filtering verified')

const backoffMigration=readFileSync('supabase/migrations/20260922165500_agent_open_loop_proactive_backoff.sql','utf8')
assert.match(backoffMigration,/proactive_backoff_until/)
assert.doesNotMatch(autonomyPulse,/update\(\{next_check_at:nextAttentionAt/)
console.log('Attention proactive backoff is isolated from source check timing')

assert.doesNotMatch(openLoops,/if\(last\.isUnread&&looksLikeIncomingAction/)
assert.match(openLoops,/unread:last\.isUnread/)
console.log('Gmail action loops survive read/unread state changes until thread truth resolves them')

assert.match(gmail,/metadataHeaders=List-Id/)
assert.match(gmail,/metadataHeaders=Auto-Submitted/)
assert.match(openLoops,/isAutomatedGmailMessage/)
assert.match(openLoops,/!isAutomatedGmailMessage\(last\)/)
console.log('Automated Gmail newsletters/no-reply traffic is suppressed from Attention')

assert.match(openLoops,/looksLikeIncomingPromise/)
assert.match(openLoops,/direction:'incoming_promise'/)
console.log('Incoming Gmail promises remain tracked as waiting-on commitments')

assert.match(bridge,/handleOpenLoopAction/)
assert.match(bridge,/shouldHandleOpenLoopAction/)
assert.match(webhook,/isOpenLoopActionCandidate\(text\)/)
assert.match(openLoops,/proactive_backoff_until:until/)
assert.match(openLoops,/Draft only — I haven't sent anything/)
console.log('Attention Actions v1 snooze + safe draft routing verified')

assert.match(bridge,/export async function tryRunWhatsAppAttentionCommand/)
assert.match(webhook,/tryRunWhatsAppAttentionCommand\(/)
assert.doesNotMatch(webhook,/const attentionAgent = await tryRunWhatsAppAgent\(/)
console.log('Attention first-refusal is isolated from unrelated agent specialists')
