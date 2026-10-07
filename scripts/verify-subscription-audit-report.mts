import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as crypto from 'node:crypto'

const actor={legacyTelegramId:101,whatsappId:'fixture-owner',userId:'fixture',name:'Fixture'}
const mission='Audit my connected Gmail for subscription receipts and renewal notices from the last 14 days, at most 15 messages. List each service, amount, currency and renewal date only when the email shows it. Do not infer whether I use a service. Read only; do not cancel anything, send emails, create reminders or change my calendar.'
const instruction="Search connected Gmail for subscription receipts and renewal notices from the last 14 days. Use search terms: 'receipt OR renewal OR subscription OR invoice' with date filter: after:2026-09-28. Return at most 15 messages. Read-only."
const urls:string[]=[]
let consent=true,failedMessage=false,auditNoise=false
const mocks:any={
  '@/lib/supabase-admin':{supabaseAdmin:{from(table:string){const q:any={select(){return q},eq(key:string,value:any){assert.equal(key,'telegram_id');assert.equal(String(value),'101');return q},maybeSingle(){return q},then(resolve:any){return Promise.resolve({data:table==='users'?{gmail_connected:true,gmail_access_token:'fixture'}:{gmail_enabled:consent},error:null}).then(resolve)}};return q}}},
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(v:string)=>v},
  '@/lib/security/google-token-crypto':{decryptGoogleToken:(v:string)=>v,hasGoogleTokenEncryptionKey:()=>false},
}
function load(file:string,extra:any={}){
  const exports:any={}
  const source=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText
  vm.runInNewContext(source,{exports,module:{exports},require:(name:string)=>mocks[name]||{},URL,URLSearchParams,Date,Buffer,console,fetch:async(url:string)=>{
    urls.push(String(url));const u=new URL(url)
    if(!u.pathname.endsWith('/messages')){
      const noisy=auditNoise&&['mail-0','mail-1','mail-2'].includes(u.pathname.split('/').pop()!)
      const noiseSubject=u.pathname.endsWith('mail-0')?'Re: [owner/repo] Keep read-only subscription audits out of checklist writes (PR #407)':u.pathname.endsWith('mail-1')?'Important: Payment benefits on your account':'Your subscription expires soon'
      const body=noisy?(u.pathname.endsWith('mail-2')?'Your subscription expires on 20 October 2026.':'New tools and payment benefits. Our guide mentions a subscription invoice.'): 'Amount paid: INR 499. Renewal date: 20 October 2026. Verification code: 123456'
      return {ok:!failedMessage,status:failedMessage?503:200,json:async()=>({id:u.pathname.split('/').pop(),snippet:body,payload:{headers:[{name:'Subject',value:noisy?noiseSubject:'Monthly subscription receipt'},{name:'From',value:'Fixture Service <billing@example.test>'}],mimeType:'text/plain',body:{data:Buffer.from(body).toString('base64url')}}})}
    }
    return {ok:true,status:200,json:async()=>({messages:Array.from({length:15},(_,i)=>({id:`mail-${i}`})),nextPageToken:'more-exist'})}
  },...extra})
  return exports
}
const reader=load('lib/agent/google-workspace-read.ts')
assert.ok(!reader.formatEmailSnippet('Verification code: &#49;&#50;&#51;&#52;&#53;&#54;').includes('123456'),'decode HTML entities before authentication redaction')
const result=await reader.searchWorkspaceEmails(actor,instruction,{missionText:mission})
const request=new URL(urls[0])
assert.match(request.searchParams.get('q')!,/^\{(?=[^}]*receipt)(?=[^}]*renewal)[^}]+\}/,'receipt categories must be OR alternatives, not required instruction words')
assert.match(request.searchParams.get('q')!,/newer_than:14d/,'rolling window must come from the owner request, not a planner-invented absolute date')
assert.match(request.searchParams.get('q')!,/subject:receipt/,'billing evidence must not be crowded out by newsletters that only mention subscriptions in their body')
assert.equal(request.searchParams.get('maxResults'),'15')
assert.equal(result.messages.length,15,'the requested bounded audit must not silently drop to six or display only five')
assert.equal(result.audit.hasMore,true,'provider pagination must be reported as an incomplete audit')
assert.ok(!JSON.stringify(result).includes('123456'),'authentication codes must be withheld from body evidence')
assert.match(reader.formatWorkspaceEmailAudit(result),/INR 499/)
assert.match(reader.formatWorkspaceEmailAudit(result),/20 October 2026/)
assert.match(reader.formatWorkspaceEmailAudit(result),/15\./)
assert.match(reader.formatWorkspaceEmailAudit(result),/more matching|more messages/i)
failedMessage=true
await assert.rejects(()=>reader.searchWorkspaceEmails(actor,instruction,{missionText:mission}),/workspace_email_.*failed/,'provider errors must not become a false zero-match audit')
failedMessage=false;consent=false;const before=urls.length
await assert.rejects(()=>reader.searchWorkspaceEmails(actor,instruction,{missionText:mission}),/workspace_email_reading_disabled/)
assert.equal(urls.length,before)
console.log('PASS: real Gmail audit query, original window, fifteen-message bound, body evidence, redaction, pagination and failed/disabled reads')

consent=true
auditNoise=true
const filtered=await reader.searchWorkspaceEmails(actor,instruction,{missionText:mission})
assert.equal(filtered.messages.length,13,'development notifications and payment marketing are not billing evidence; explicit expiry without an amount remains evidence')
assert.equal(filtered.audit.inspected,15)
assert.equal(filtered.audit.excluded,2)
assert.ok(!reader.formatWorkspaceEmailAudit(filtered).includes('PR #407'))
assert.match(reader.formatWorkspaceEmailAudit(filtered),/15 candidate messages checked; 2 excluded/)
assert.match(reader.formatWorkspaceEmailAudit(filtered),/20 October 2026/)
auditNoise=false
assert.equal(reader.hasEmailBillingEvidence({subject:'Reminder - Your Outstanding WeWork invoice',evidence:'This is regarding the outstanding dues on your account. Your invoice balance has not been settled.'}),true)
assert.equal(reader.hasEmailBillingEvidence({subject:'Your receipt from Anthropic, PBC',evidence:'Receipt from Anthropic, PBC $23.60 Paid October 5, 2026'}),true)
assert.equal(reader.hasEmailBillingEvidence({subject:'Confirm your US$9.99 payment',evidence:'Confirm your monthly payment to the service.'}),true)
assert.equal(reader.workspaceEmailAuditScope('Find my Netflix invoice in Gmail'),null,'a targeted invoice lookup must not become an inbox audit')
await reader.searchWorkspaceEmails(actor,'Find email subject "Flight ticket"',{missionText:mission})
assert.equal(new URL(urls.at(-2)!).searchParams.get('format'),'metadata')
assert.equal(new URL(urls.filter(u=>new URL(u).pathname.endsWith('/messages')).at(-1)!).searchParams.get('q'),'subject:"Flight ticket" -in:spam -in:trash','another email step in an audit mission keeps its own query')
assert.throws(()=>reader.workspaceEmailAuditScope('Audit Gmail subscriptions from the last 400 days, at most 15 messages'),/scope_out_of_range/)
const missing=reader.formatWorkspaceEmailAudit({audit:{days:14,limit:15,hasMore:false},messages:[{subject:'Receipt',from:'Fixture',snippet:'Thanks for subscribing'}]})
assert.match(missing,/Not explicitly shown/)
assert.ok(!missing.includes('499'))

// Exercise actual same-brain reader -> plan execution -> persisted artifact -> private page.
const rows:Record<string,any[]>={agent_runs:[],agent_steps:[],agent_artifacts:[],agent_activity:[],agent_approvals:[]}
let nextId=0,reportReadError=false,reportQueries=0
const reportId='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const readDb=mocks['@/lib/supabase-admin'].supabaseAdmin
const db={from(table:string){
  if(table==='users'||table==='user_consent_settings')return readDb.from(table)
  let filters:[string,any][]=[],inserted:any[]=[],patch:any=null,single=false
  const q:any={select(){return q},eq(k:string,v:any){filters.push([k,v]);return q},ilike(k:string,v:any){filters.push([k,v]);return q},order(){return q},limit(){return q},maybeSingle(){single=true;return q},single(){single=true;return q},insert(value:any){inserted=(Array.isArray(value)?value:[value]).map(v=>({...v,id:table==='agent_artifacts'?reportId:`fixture-${++nextId}`}));return q},update(value:any){patch=value;return q},then(resolve:any,reject:any){return Promise.resolve().then(()=>{
    if(table==='agent_artifacts'&&!inserted.length&&!patch){reportQueries++;if(reportReadError)return {data:null,error:{message:'fixture outage'}}}
    if(!rows[table])return {data:single?null:[],error:null}
    if(inserted.length)rows[table].push(...inserted)
    const selected=inserted.length?inserted:rows[table].filter(row=>filters.every(([k,v])=>String(row[k])===String(v)))
    if(patch)selected.forEach(row=>Object.assign(row,patch))
    return {data:single?selected[0]||null:selected,error:null}
  }).then(resolve,reject)}};return q
}}
mocks['@/lib/supabase-admin']={supabaseAdmin:db}
mocks.crypto=crypto
mocks['node:crypto']=crypto
mocks['./google-workspace-read']=reader
mocks['./typed-object-context']={rememberTypedObjects:async()=>{}}
mocks['@/lib/feature-intents-legacy']={routeFeatureIntent:async()=>{throw new Error('unexpected legacy fallback')}}
mocks['@/lib/bot/process-message']={processIncomingMessage:async()=>{throw new Error('unexpected message fallback')}}
mocks['./same-brain']=load('lib/agent/same-brain.ts')
mocks['./artifact-presentation']=load('lib/agent/artifact-presentation.ts')
mocks['@/lib/agent/artifact-presentation']=mocks['./artifact-presentation']
mocks['./policy']=load('lib/agent/policy.ts')
mocks['./classifier']=load('lib/agent/classifier.ts')
mocks['./approval-fingerprint']=load('lib/agent/approval-fingerprint.ts')
mocks['./approval-binding']=load('lib/agent/approval-binding.ts')
mocks['./model-usage']={recordTaskModelUsage:async()=>{}}
let plannerCalls=0
mocks['./planner-provider']={completeAgentPlanPrompt:async()=>{plannerCalls++;return JSON.stringify({title:'Audit',reason:'Read and list',steps:[{tool:'email',title:'Read mail',instruction},{tool:'lists',title:'Create subscription audit list',instruction:"Create a list titled 'Gmail Subscription Audit (Last 14 Days)' with columns: Service Name | Amount | Currency | Renewal Date. Populate only with data explicitly shown in the emails retrieved."}]})}}
const planner=load('lib/agent/general-planner.ts')
const livePlan=await planner.planGeneralAgentRequest(mission)
assert.equal(plannerCalls,0,'a pure read-only audit must have a deterministic report plan instead of delegating list/report semantics to a model')
assert.deepEqual(Array.from(livePlan.steps,(s:any)=>s.tool),['email','artifact'],'the exact live prompt must return findings, not mutate the checklist store')
assert.equal(planner.shouldUseGeneralPlanner('Audit my Gmail subscriptions from the last 7 days, at most 3 messages.'),true,'a simple audit must reach the deterministic plan even without another domain')
assert.equal(planner.readOnlySubscriptionAuditPlan('Audit my Gmail subscriptions from the last 14 days and show my calendar.'),null,'an independent calendar read must not be swallowed')
assert.equal(planner.readOnlySubscriptionAuditPlan('Audit my Gmail subscriptions from the last 14 days and cancel Netflix.'),null,'positive consequential actions retain normal approval routing')
assert.equal(planner.readOnlySubscriptionAuditPlan('Audit my Gmail subscriptions from the last 14 days and create a shopping list.'),null)
assert.equal(planner.readOnlySubscriptionAuditPlan('Audit my Gmail subscriptions from the last 14 days; do not send email, but create a reminder.'),null,'an affirmative request after negation must survive')
assert.equal(planner.readOnlySubscriptionAuditPlan('Audit my Gmail subscriptions from the last 14 days and add a review event to my calendar.'),null,'add is a positive calendar write')
assert.equal(planner.readOnlySubscriptionAuditPlan('Audit my Gmail subscriptions from the last 14 days and remember my renewal date.'),null,'memory writes are independent requests')
const steps=[{tool:'email',title:'Search subscription receipts',instruction},{tool:'artifact',title:'Save subscription report',instruction:'Create a private report from the email findings',artifactTitle:'Subscription audit',artifactType:'research_brief'}]
const prepared={plan:{title:'Subscription audit',reason:'Read and report',steps},modelUsage:[],startedAt:new Date().toISOString()}
const completed=await planner.tryRunGeneralPlan({actor,surface:'web',text:mission,prepared:{...prepared,plan:livePlan}})
assert.equal(completed.status,'completed')
assert.match(completed.text,/INR 499/,'the last artifact step must preserve findings in the reply')
assert.match(completed.text,new RegExp('/dashboard/reports/'+reportId))
assert.match(rows.agent_artifacts[0].content_json.sections[0].result.reply,/15\./,'all fifteen findings survive persistence')
assert.ok(!JSON.stringify(rows).includes('123456'))
const direct=await mocks['./same-brain'].dispatchThroughSameBrain({actor,text:mission,internalStep:true})
assert.match(direct.text,/Gmail subscription audit/,'negative no-send instruction must still reach the read-only Gmail path')

let session:any={telegramId:'101'}
mocks['@/lib/dashboard/session']={getSession:async()=>session}
mocks['next/navigation']={notFound:()=>{throw new Error('NOT_FOUND')}}
mocks['react/jsx-runtime']={jsx:(type:any,props:any)=>({type:typeof type==='function'?type.name:type,props}),jsxs:(type:any,props:any)=>({type:typeof type==='function'?type.name:type,props})}
const page=load('app/dashboard/(app)/reports/[id]/page.tsx')
assert.match(JSON.stringify(await page.default({params:Promise.resolve({id:reportId})})),/15\./)
session={telegramId:'202'}
await assert.rejects(()=>page.default({params:Promise.resolve({id:reportId})}),/NOT_FOUND/,'another owner cannot read the report')
session=null;const queriesBefore=reportQueries
await assert.rejects(()=>page.default({params:Promise.resolve({id:reportId})}),/NOT_FOUND/)
assert.equal(reportQueries,queriesBefore,'signed-out requests stop before private database reads')
session={telegramId:'101'};reportReadError=true
await assert.rejects(()=>page.default({params:Promise.resolve({id:reportId})}),/report_read_unavailable/)
reportReadError=false
const approvalPlan={...prepared,plan:{...prepared.plan,steps:[...steps,{tool:'calendar',title:'Schedule review',instruction:'Create calendar event: Subscription review on 2026-10-20 at 10am'}]}}
const gated=await planner.tryRunGeneralPlan({actor,surface:'web',text:'Audit subscriptions and prepare a calendar review',prepared:approvalPlan})
assert.equal(gated.status,'waiting_approval')
assert.match(gated.text,new RegExp('/dashboard/reports/'+reportId),'an approval pause must publish the safe report link instead of discarding its completed output')
assert.equal(rows.agent_approvals.length,1)
assert.match(rows.agent_artifacts[0].content_json.sections[0].result.reply,/Gmail subscription audit/,'the readable artifact survives the later approval pause')
assert.equal(rows.agent_steps.at(-1).status,'waiting_approval')
console.log('PASS: actual same-brain and plan execution publish evidence and private report; all results retained; report owner/session/outage boundaries; artifact survives approval pause')
