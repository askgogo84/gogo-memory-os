import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { formatEmailSnippet } from '../lib/agent/google-workspace-read'
import { readFileSync } from 'node:fs'
import { retiredRunReason } from '../lib/agent/task-lifecycle'
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
assert.match(pulse,/agent_open_loops/)
assert.match(pulse,/usefulOpenLoopTitle/)
assert.doesNotMatch(pulse,/\*Open loop\*:/)
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
assert.match(openLoops,/\(bucket\*pageSize\)%sorted\.length/)
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

assert.match(openLoops,/const draftable=target\.kind==='followup'\|\|target\.kind==='waiting_on'\|\|sourceType==='gmail_thread'/)
assert.match(openLoops,/I won't invent a follow-up recipient/)
console.log('Attention follow-up drafts are limited to loops with a real counterpart')

assert.match(openLoops,/recentOpenLoopListSnapshot/)
assert.match(openLoops,/openLoopFromSnapshot/)
assert.match(openLoops,/metadata_json\.open_loop_ids/)
assert.doesNotMatch(openLoops,/const loops=await listOpenLoops\(params\.actor\.legacyTelegramId,20\)[\s\S]{0,500}const target=loops\[/)
assert.match(openLoops,/\['approval','agent_run','life_event_action','meeting_action'\]\.includes\(sourceType\)/)
assert.match(openLoops,/open_loop_followup_snooze_failed/)
assert.match(openLoops,/check_at:until/)
console.log('Attention numbered actions are snapshot-bound and snooze truth matches notification ownership')

assert.match(openLoops,/snooze 2 for 4 hours/)
assert.match(openLoops,/draft follow-up for 2/)
console.log('Attention scout page rotation + action discoverability verified')

// Execute the exported production handler and both entry points with a fresh
// Gmail transport. Stored reminders/open loops are deliberately inaccessible.
let inboxConnected=true, inboxEnabled=true, readFails=false, freshCalls=0
const queries:Array<{table:string;owner:any}>=[]
const fixtureDb={from:(table:string)=>{
  assert.ok(['users','user_consent_settings'].includes(table),'inbox read must not use saved attention or reminder rows')
  const record={table,owner:null as any};queries.push(record)
  const q:any={select:()=>q,eq:(key:string,value:any)=>{if(key==='telegram_id')record.owner=value;return q},maybeSingle:async()=>({error:null,data:table==='users'
    ? {gmail_connected:inboxConnected,gmail_email:'owner@example.test',gmail_access_token:'fixture-token',telegram_id:42,whatsapp_id:'fixture-wa',name:'Fixture'}
    : {gmail_enabled:inboxEnabled}})}
  return q
}}
const message=(id:string,from:string,snippet:string,extra:any={})=>({id,from,to:'owner@example.test',subject:'Please review You&#39;re invited',snippet,internalDate:Date.parse('2026-10-07T12:00:00Z'),...extra})
const fixtureThreads=[
  {id:'needs-reply',messages:[message('old','owner@example.test','My earlier message'),message('new','Alice <alice@example.test>','Can you review the plan? Your verification code is 123456.')]},
  {id:'already-replied',messages:[message('before','Alice <alice@example.test>','Please review'),message('after','owner@example.test','Done',{internalDate:Date.parse('2026-10-07T12:01:00Z')})]},
  {id:'newsletter',messages:[message('bulk','news@example.test','Please reply',{listId:'newsletter'})]},
  {id:'auto',messages:[message('auto','no-reply@example.test','Please confirm')]},
  {id:'promise',messages:[message('promise','Bob <bob@example.test>',"I will send the update tomorrow.",{subject:'Update'})]},
]
function loadFixture(path:string,requireFn:(name:string)=>any,extra:any={}){
  const exports:any={}
  runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:requireFn,console,Date,Intl,Set,Map,URL,process,...extra})
  return exports
}
const inboxModule=loadFixture('lib/agent/open-loops.ts',name=>
  name==='@/lib/supabase-admin'?{supabaseAdmin:fixtureDb}:
  name==='@/lib/security/google-token-crypto'?{decryptGoogleToken:(value:any)=>value||''}:
  name==='./google-workspace-read'?{formatEmailSnippet}:
  name==='@/lib/services/google-gmail'?{fetchGmailAttentionThreads:async()=>{freshCalls++;if(readFails)throw Error('fixture read failure');return fixtureThreads},refreshGmailAccessToken:async()=>''}:{}
)
const actor={legacyTelegramId:42,userId:'fixture-user',whatsappId:'fixture-wa',name:'Fixture',timezone:'Asia/Kolkata'}
const exactInboxPrompt='Show emails that need my reply. Do not send anything.'
assert.equal(inboxModule.isInboxReplyReadQuery(exactInboxPrompt),true)
assert.equal(inboxModule.isInboxReplyReadQuery('Which emails do I need to reply to?'),true)
for(const text of ['Send emails that need my reply','Show emails that need my reply and send them','Remind me to reply to Alice'])assert.equal(inboxModule.isInboxReplyReadQuery(text),false)
const fresh=await inboxModule.handleInboxReplyRead({actor,text:exactInboxPrompt})
assert.match(fresh.text,/Gmail checked at/);assert.match(fresh.text,/Checked 5 recent threads/)
assert.match(fresh.text,/Alice/);assert.match(fresh.text,/You're invited/)
assert.doesNotMatch(fresh.text,/123456|Bob|newsletter|no-reply|reminder set/i)
assert.match(fresh.text,/Nothing sent/);assert.equal(fresh.verification.verified,true)
const callsBeforeDisabled=freshCalls
inboxEnabled=false
assert.match((await inboxModule.handleInboxReplyRead({actor,text:exactInboxPrompt})).text,/turned off/)
assert.equal(freshCalls,callsBeforeDisabled);inboxEnabled=true;inboxConnected=false
assert.match((await inboxModule.handleInboxReplyRead({actor,text:exactInboxPrompt})).text,/Connect Gmail/)
assert.equal(freshCalls,callsBeforeDisabled);inboxConnected=true;readFails=true
const failed=await inboxModule.handleInboxReplyRead({actor,text:exactInboxPrompt})
assert.equal(failed.status,'failed');assert.doesNotMatch(failed.text,/Alice|no emails need|Gmail checked/i);readFails=false

const waInbox=loadFixture('lib/agent/whatsapp-bridge.ts',name=>name==='./open-loops'?inboxModule:name==='./gmail-verification'?{isGmailVerificationQuery:()=>false}:{})
assert.equal((await waInbox.tryRunWhatsAppAttentionCommand({user:{id:'fixture-user',telegramId:42,whatsappId:'fixture-wa',name:'Fixture'},text:exactInboxPrompt})).handledBy,'inbox-reply-read')
const webInbox=loadFixture('app/api/dashboard/chat/route.ts',name=>
  name==='@/lib/agent/open-loops'?inboxModule:
  name==='@/lib/supabase-admin'?{supabaseAdmin:{from:(table:string)=>table==='conversations'?{insert:async()=>({error:null})}:fixtureDb.from(table)}}:
  name==='@/lib/dashboard/session'?{getSession:async()=>({telegramId:'42'})}:
  name==='@/lib/agent/actor'?{resolveAgentActor:async()=>actor}:
  name==='next/server'?{NextResponse:{json:(data:any)=>data}}:{}
)
const webFresh=await webInbox.POST({headers:{get:()=> 'https://app.example.test'},nextUrl:{host:'app.example.test'},json:async()=>({text:exactInboxPrompt})})
assert.equal(webFresh.handledBy,'inbox-reply-read','real web POST must claim the read before content/general planners')
assert.ok(queries.every(q=>q.owner===42),'every connection/consent read is owner scoped')
console.log('Fresh inbox reply reads: real handler + web POST + WhatsApp first refusal, ownership, consent, errors, automation suppression and secret-safe text verified')

let failThread=false
const gmailTransport=loadFixture('lib/services/google-gmail.ts',()=>({}),{setTimeout,clearTimeout,fetch:async(url:string,options:any)=>{
  assert.equal(options.method,undefined,'Gmail attention performs only GET requests')
  assert.equal(options.cache,'no-store')
  const list=url.includes('/messages?')
  return {ok:list||!failThread,status:list||!failThread?200:503,json:async()=>list
    ? {messages:[{threadId:'fixture-thread'}]}
    : {id:'fixture-thread',messages:[{id:'message',internalDate:'1791374400000',payload:{headers:[{name:'From',value:'Alice <alice@example.test>'}]},snippet:'Please review'}]}}
}})
assert.equal((await gmailTransport.fetchGmailAttentionThreads('fixture-token',12)).length,1)
failThread=true
await assert.rejects(()=>gmailTransport.fetchGmailAttentionThreads('fixture-token',12),/gmail_attention_thread_read_incomplete/,'a partial transport failure must not be reported as an empty successful inbox scan')

assert.ok(retiredRunReason({status:'paused',error:'stale_provider_access_limited'}))
assert.equal(retiredRunReason({status:'paused',updated_at:'2020-01-01'}),null)
assert.doesNotMatch(openLoops,/status[^\n]{0,80}paused[^\n]{0,120}age\s*>/i)
assert.match(openLoops,/\.range\(from,from\+pageSize-1\)/)
assert.match(autonomyStatus,/terminalPauseErrors/)
assert.match(autonomyStatus,/\.limit\(30\)/)
assert.match(autonomyStatus,/\.slice\(0,6\)/)
console.log('Only known terminal pauses are retired; resumable paused missions remain visible and filtering happens before the display limit')
