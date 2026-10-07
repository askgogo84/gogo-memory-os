import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {parsePriceComparison, namesRetailerPriceRead} from '../lib/commerce/comparison-model'
import {formatOutgoingText} from '../lib/bot/format-response'
import * as contentWorkflows from '../lib/agent/content-workflows'
import * as signature from '../lib/security/webhook-signature'
import * as inputNormalizer from '../lib/bot/input-normalizer'
import * as previewRouting from '../lib/services/whatsapp-preview-routing'

// Fixed phone incident: Wed 7 Oct 2026, 12:37 IST.
const RealDate = Date
let now = RealDate.parse('2026-10-07T07:07:00Z')
class FixedDate extends RealDate {
  constructor(value?: string | number) { super(value === undefined ? now : value) }
  static now() { return now }
}
globalThis.Date = FixedDate as DateConstructor

const intentModule: any = {}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/bot/detect-intent.ts', import.meta.url), 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
{exports: intentModule, Date: FixedDate, Intl, console, require(name: string) {
  if (name === './reminder-command') return {isTimeFirstReminder: () => false}
  if (name === '@/lib/agent/food-comparison-intent') return {isFoodComparisonRequest: () => false}
  if (name === '@/lib/data/lists-core') return {classifyCheckVerb: () => null}
  if (name === '@/lib/bot/handlers/calendar-actions') return {CALENDAR_WORD_RE: /calendar/}
  if (name === '@/lib/bot/flight-codes') return {hasConcreteFlightCode: () => false}
  throw new Error(name)
}})
const {detectIntent} = intentModule

const reminders: any = {}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/bot/handlers/reminders.ts', import.meta.url), 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
{exports: reminders, Date: FixedDate, Intl, console, require(name: string) {
  if (name === '../reminder-command') return {isTimeFirstReminder: () => false}
  if (name === '@/lib/services/reminder-series') return {describeCadence: () => '', formatReminderTimeOfDay: () => ''}
  throw new Error(name)
}})

const insertedFriends: any[] = []
const friendDb = {from(table: string) {
  if (table === 'users') {
    const query: any = {select() {return query}, eq() {return query}, maybeSingle: async () => ({data: {timezone: 'Asia/Kolkata'}})}
    return query
  }
  if (table === 'reminders') return {insert: async (row: any) => {insertedFriends.push(row); return {error: null}}}
  throw new Error(`Unexpected friend table: ${table}`)
}}
const friend: any = {}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/bot/handlers/friend-reminders.ts', import.meta.url), 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
{exports: friend, Date: FixedDate, Intl, console, require(name: string) {
  if (name === './reminders') return reminders
  if (name === '@/lib/supabase-admin') return {supabaseAdmin: friendDb}
  if (name === '@/lib/ist') return {istDayWindow: () => {throw new Error('No live clock')}}
  throw new Error(name)
}})

const compound: any = {}
runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/bot/compound-shopping-friend.ts', import.meta.url), 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
{exports: compound, require(name: string) {
  if (name === '@/lib/commerce/comparison-model') return {parsePriceComparison}
  if (name === '@/lib/bot/handlers/friend-reminders') return {detectFriendReminder: friend.detectFriendReminder}
  throw new Error(name)
}})

const conversations: any[] = []
const contacts = new Map<string, string>()
let created = 0
let browserClaims = 0
let webSearchClaims = 0
let pending: any = null
const db = {from(table: string) {
  if (table !== 'conversations') throw new Error(`Unexpected table: ${table}`)
  return {insert(row: any) {
    conversations.push(row)
    if (row.content.startsWith('[pending_friend]')) pending = JSON.parse(row.content.slice('[pending_friend]'.length))
    return Promise.resolve({error: null})
  }}
}}
const noMatch = new Set(['handleLinkVaultText', 'tryTypedTimeRouting', 'tryFoodComparison', 'getLatestFollowupState', 'isAmPmChoice'])
const actual: Record<string, any> = {
  '@/lib/agent/content-workflows': contentWorkflows,
  '@/lib/supabase-admin': {supabaseAdmin: db},
  './resolve-user': {resolveUser: async () => ({id: 'owner', telegramId: 42, whatsappId: '+919999999999', name: 'Gogo', tier: 'free'})},
  './detect-intent': {detectIntent},
  './handlers/reminders': reminders,
  './format-response': {formatOutgoingText},
  '@/lib/commerce/comparison-model': {namesRetailerPriceRead},
  '@/lib/commerce/price-comparison': {tryPriceComparison: async ({text}: {text: string}) => {
    const parsed = parsePriceComparison(text)
    if (!parsed) return null
    browserClaims++
    return {text: `Browser check queued: ${parsed.providers.join(', ')}`, handledBy: 'price-comparison'}
  }},
  '@/lib/web-search': {searchWeb: async () => {webSearchClaims++; throw new Error('Retailer read fell through to web search')}},
  '@/lib/limits': {getFriendReminderCap: () => 3},
  '@/lib/bot/handlers/friend-reminders': {
    ...friend,
    getPendingFriend: async () => pending?.stage === 'done' ? null : pending,
    countTodayFriendReminders: async () => 0,
    resolveFriendContact: async (_owner: number, name: string) => contacts.get(name) || null,
    saveFriendContact: async (_owner: number, name: string, number: string) => {contacts.set(name, number)},
    createFriendReminder: async ({whenIso, task}: {whenIso: string; task: string}) => {
      assert.equal(whenIso, '2026-10-08T05:30:00.000Z', 'a next-day confirmation keeps the original absolute time')
      assert.match(task, /^check with Tom/i)
      assert.doesNotMatch(task, /Gogo|can you|Urgent|when Matthew wakes/i)
      created++
      return {whenHuman: friend.friendTimeLabel(whenIso)}
    },
  },
}
const source = readFileSync(new URL('../lib/bot/process-message.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
const exports: any = {}
runInNewContext(compiled, {exports, Date: FixedDate, Intl, URL, console, process: {env: {}}, require(name: string) {
  if (actual[name]) return actual[name]
  return new Proxy({}, {get(_target, key) {
    if (noMatch.has(String(key))) return () => null
    throw new Error(`Unexpected dependency: ${name}.${String(key)}`)
  }})
}})
const run = (text: string) => exports.processIncomingMessage({channel: 'whatsapp', externalUserId: '+919999999999', text})
const routeSource = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
const combined = "What's the price of iPhone 17 Pro 256GB on flipkart.com?\n" +
  'Check the live price of Sony WH-1000XM5 on croma.com\n' +
  'remind Matthew to check with Tom about the Patek for Mukesh tomorrow at 11am. Urgent.'
const combinedSteps = compound.splitCompoundShoppingFriendRequests(combined)
assert.deepEqual(Array.from(combinedSteps || [], (step: any) => `${step.kind}:${step.text}`), [
  "price:What's the price of iPhone 17 Pro 256GB on flipkart.com?",
  'price:Check the live price of Sony WH-1000XM5 on croma.com',
  'friend:remind Matthew to check with Tom about the Patek for Mukesh tomorrow at 11am. Urgent.',
])
assert.equal(compound.splitCompoundShoppingFriendRequests('What is the gold price?\nRemind me tomorrow'), null)
assert.equal(compound.splitCompoundShoppingFriendRequests('What is the price of bitcoin?\nCheck Croma hours'), null)
assert.ok(routeSource.indexOf('const compoundReplies = await runCompoundShoppingFriendRequests(text,') < routeSource.indexOf('const typedReply=await tryTypedTimeRouting'),
  'WhatsApp must split independently recognised requests before whole-message routing')
assert.ok(routeSource.indexOf('namesRetailerPriceRead(text)') > 0)
assert.ok(routeSource.indexOf('namesRetailerPriceRead(text)') < routeSource.indexOf('const calendarReply=await routeFeatureIntent'),
  'WhatsApp must claim retailer reads before feature routing')
assert.match(routeSource, /if \(yesFollowup && !preserveFriendFlow\)/, 'friend YES must not create meeting-action reminders')
assert.match(routeSource, /if\(jevClarify && !preserveFriendFlow\)/, 'Jev must not discard a pending friend request')
assert.match(routeSource, /const featureReply = preserveFriendFlow \? null/, 'feature routing must leave delegated reminders for PIM')

try {
  for (const message of ["What's the price of iPhone 17 Pro 256GB on flipkart.com?", 'Check the live price of Sony WH-1000XM5 on croma.com']) {
    const reply = await run(message)
    assert.equal(reply.handledBy, 'price-comparison', message)
  }
  assert.equal(browserClaims, 2)
  assert.equal(webSearchClaims, 0, 'an upstream web_search claim is a failure')
  for (const message of ["what's the gold price today", 'upgrade price', 'price of bitcoin', 'Find veg burger on Swiggy'])
    assert.equal(parsePriceComparison(message), null, message)

  const compoundErrors: unknown[] = []
  const combinedReplies = await compound.runCompoundShoppingFriendRequests(combined, {
    checkPrice: async (step: string) => (await run(step)).text,
    prepareFriend: async (step: string) => (await run(step)).text,
    onError: (error: unknown) => {compoundErrors.push(error)},
  })
  assert.equal(combinedReplies?.length, 3, 'one bubble must produce three independently routed replies')
  assert.match(combinedReplies[0], /flipkart/i)
  assert.match(combinedReplies[1], /croma/i)
  assert.match(combinedReplies[2], /Matthew.*WhatsApp number/i)
  assert.equal(compoundErrors.length, 0)
  assert.equal(browserClaims, 4)
  assert.equal(webSearchClaims, 0)

  const partial = await compound.runCompoundShoppingFriendRequests(combined, {
    checkPrice: async (step: string) => {if (/flipkart/i.test(step)) throw new Error('store failed'); return 'Croma queued'},
    prepareFriend: async () => 'Matthew needs a number',
    onError: (error: unknown) => {compoundErrors.push(error)},
  })
  assert.match(partial[0], /resend that request separately/i)
  assert.equal(partial[1], 'Croma queued')
  assert.equal(partial[2], 'Matthew needs a number')
  assert.equal(compoundErrors.length, 1)

  const past = await run('remind Matthew to check with Tom about the Patek for Mukesh today at 11am. Urgent.')
  assert.match(past.text, /already passed/i)
  assert.doesNotMatch(past.text, /WhatsApp number/i)
  assert.equal(created, 0)
  assert.equal(pending?.stage, 'time', 'a corrected time must retain Matthew and the task')
  const corrected = await run('tomorrow at 11am')
  assert.match(corrected.text, /WhatsApp number/i)
  assert.equal(pending?.stage, 'number')

  const vague = await run('Gogo, can you ask Matthew to check with Tom for Patek for Mukesh when Matthew wakes up tomorrow? Urgent.')
  assert.match(vague.text, /exact date and time/i)
  assert.equal(pending?.stage, 'time')
  assert.match((await run('YES')).text, /specific future date and time/i)
  assert.equal(created, 0)
  const time = await run('tomorrow at 11am')
  assert.match(time.text, /WhatsApp number/i)
  assert.equal(pending?.stage, 'number')
  assert.equal(pending?.whenIso, '2026-10-08T05:30:00.000Z')
  assert.match((await run('YES')).text, /WhatsApp number first/i)
  assert.equal(created, 0)
  now = RealDate.parse('2026-10-08T00:30:00Z') // 6 AM IST, still before the requested 11 AM
  const number = await run('+91 98765 43210')
  assert.match(number.text, /Reply YES to schedule/i)
  assert.equal(pending?.stage, 'confirm')
  assert.equal(created, 0, 'sending a phone number cannot send a reminder')
  const yes = await run('YES')
  assert.match(yes.text, /Done.*remind Matthew/i)
  assert.equal(created, 1)
  assert.equal(pending?.stage, 'done')
  await friend.createFriendReminder({ownerTelegramId: 42, senderName: 'Gogo', recipientWhatsapp: '+919876543210',
    rest: 'check with Tom tomorrow at 11am', whenIso: '2026-10-08T05:30:00.000Z', task: 'check with Tom about the Patek for Mukesh'})
  assert.equal(insertedFriends[0].remind_at, '2026-10-08T05:30:00.000Z')
  assert.equal(insertedFriends[0].message, 'from Gogo: check with Tom about the Patek for Mukesh')

  now = RealDate.parse('2026-10-06T19:03:00Z') // Wed 7 Oct, 00:33 IST
  assert.equal(friend.parseFriendTime('check with Tom tomorrow at 11am')?.remindAtIso, '2026-10-07T05:30:00.000Z')
} finally { globalThis.Date = RealDate }
console.log('Shopping and friend reminder production-order regressions passed')

// Execute the actual exported WhatsApp POST. The older harness called PIM and
// checked source order, so it could miss a handler earlier in the real webhook.
const sent:string[]=[]
const webhookErrors:unknown[]=[]
const events=new Map<string,any>()
let featureClaims=0
const fixtureUser={id:'owner',telegramId:42,whatsappId:'+919999999999',name:'Gogo',tier:'free'}
const unrelated=(module:string)=>new Proxy({}, {get:(_target,key)=>{
  const name=String(key)
  if(/^(?:is|detect|parse)/.test(name))return ()=>null
  if(/^(?:try|build|getLatestFollowupState)/.test(name))return ()=>null
  if(/^(?:observe|capture|autoResolve|record)/.test(name))return async()=>null
  throw Error(`Unmodelled webhook dependency: ${module}.${name}`)
}})
function executeModule(file:string,deps:Record<string,any>){
  const result:any={}
  runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports:result,Date:FixedDate,Intl,URL,console:{...console,error:(...args:any[])=>webhookErrors.push(args)},process,Buffer,
    require:(name:string)=>deps[name]||unrelated(name),
  })
  return result
}
const realFeature=executeModule('lib/feature-intents.ts',{
  '@/lib/bot/input-normalizer':inputNormalizer,
  '@/lib/feature-intents-legacy':{routeFeatureIntent:async()=>{featureClaims++;return 'Upstream web search claimed this request'}},
})
const webhook=executeModule('app/api/webhooks/whatsapp/route.ts',{
  ...actual,
  'next/server':{NextResponse:Response},
  '@/lib/security/webhook-signature':signature,
  '@/lib/feature-intents':realFeature,
  '@/lib/services/whatsapp-preview-routing':previewRouting,
  '@/lib/bot/process-message':{processIncomingMessage:exports.processIncomingMessage},
  '@/lib/bot/compound-shopping-friend':compound,
  '@/lib/bot/handlers/friend-reminders':{...actual['@/lib/bot/handlers/friend-reminders'],isFriendReminderFollowupCandidate:()=>false},
  '@/lib/bot/resolve-user':{resolveUser:async()=>fixtureUser},
  '@/lib/agent/actor':{resolveAgentActor:async()=>({userId:'owner',legacyTelegramId:42,whatsappId:fixtureUser.whatsappId,name:'Gogo'})},
  '@/lib/bot/handlers/shared-memory':{handleBucketCommand:async()=>null},
  '@/lib/channels/whatsapp':{sendWhatsAppMessage:async(_to:string,text:string)=>{sent.push(text)},sendWhatsAppTyping:async()=>{}},
  '@/lib/agent/brain-runtime-guard':{
    claimInboundEvent:async({eventKey}:any)=>{
      const existing=events.get(eventKey)
      if(existing)return {...existing,duplicate:true}
      const claim={id:eventKey,ownerToken:'fixture',status:'claimed',duplicate:false};events.set(eventKey,claim);return claim
    },
    acquireBrainUserLease:async()=>({ownerToken:'fixture'}),releaseBrainUserLease:async()=>true,
    completeInboundEvent:async({id}:any)=>{events.get(id).status='completed'},failInboundEvent:async({id}:any)=>{events.get(id).status='failed'},
  },
  '@/lib/agent/content-workflow-entry':{tryRunContentWorkflow:async()=>null},
  '@/lib/bot/handlers/user-timezone':{inferTimezoneFromPhone:()=> 'Asia/Kolkata',isTimezoneCommand:()=>false},
})
const previousToken=process.env.TWILIO_AUTH_TOKEN
process.env.TWILIO_AUTH_TOKEN='fixture-token'
const postWebhook=(text:string,sid:string)=>{
  const url='https://fixture.invalid/api/webhooks/whatsapp'
  const params={From:'whatsapp:+919999999999',Body:text,NumMedia:'0',MessageSid:sid,ProfileName:'Gogo'}
  const signed=signature.computeTwilioSignature('fixture-token',url,params)
  return webhook.POST(new Request(url,{method:'POST',body:new URLSearchParams(params),headers:{'x-twilio-signature':signed}}))
}
try{
  pending=null
  contacts.clear()
  now=RealDate.parse('2026-10-07T07:07:00Z')
  for(const [index,message] of ["What's the price of iPhone 17 Pro 256GB on flipkart.com?",'Check the live price of Sony WH-1000XM5 on croma.com'].entries()){
    const before=sent.length
    assert.equal((await postWebhook(message,`SMretailer${index}`)).status,200)
    assert.deepEqual(webhookErrors,[],'the webhook must not catch a fixture or routing failure')
    assert.equal(sent.length,before+1)
    assert.match(sent.at(-1)!,/Browser check queued/)
    assert.equal(events.get(`SMretailer${index}`).status,'completed')
  }
  const before=sent.length
  assert.equal((await postWebhook(combined,'SMcombined')).status,200)
  assert.equal(sent.length,before+3)
  assert.match(sent[before],/flipkart/i);assert.match(sent[before+1],/croma/i)
  assert.match(sent[before+2],/Matthew.*WhatsApp number/i)
  assert.equal(events.get('SMcombined').status,'completed')
  const beforeDuplicate=browserClaims
  await postWebhook(combined,'SMcombined')
  assert.equal(sent.length,before+3,'redelivery of the same inbound event cannot send duplicate replies')
  assert.equal(browserClaims,beforeDuplicate,'redelivery cannot start duplicate retailer tasks')
  assert.equal(featureClaims,0,'the real webhook must claim retailer reads before exported feature routing')
  assert.equal(webSearchClaims,0,'the real PIM must not dispatch retailer reads to web search')
  assert.deepEqual(webhookErrors,[],'a caught webhook failure is not a successful routing test')
}finally{
  if(previousToken===undefined)delete process.env.TWILIO_AUTH_TOKEN
  else process.env.TWILIO_AUTH_TOKEN=previousToken
}
console.log('Actual signed webhook POST → compound router/PIM → retailer claim; upstream search and duplicate dispatch checks passed')

// Execute web POST too: the live incident combined two different products into
// a single subject with both retailers, despite WhatsApp's splitter passing.
const webClaims:any[]=[]
const webHistory:any[]=[]
let webSession:any={telegramId:'42'}
let failFlipkart=false
const web=executeModule('app/api/dashboard/chat/route.ts',{
  'crypto':{randomUUID:()=> 'fixture-web'},
  'next/server':{NextResponse:{json:(data:any,options:any={})=>new Response(JSON.stringify(data),{status:options.status||200})}},
  '@/lib/dashboard/session':{getSession:async()=>webSession},
  '@/lib/supabase-admin':{supabaseAdmin:{from:(table:string)=>{
    if(table==='conversations')return {insert:async(rows:any[])=>{webHistory.push(...rows);return {error:null}}}
    assert.equal(table,'users')
    const query:any={select:()=>query,eq:(key:string,value:any)=>{assert.equal(key,'telegram_id');assert.equal(value,42);return query},
      maybeSingle:async()=>({data:{telegram_id:42,whatsapp_id:fixtureUser.whatsappId,name:'Gogo'}})}
    return query
  }}},
  '@/lib/agent/actor':{resolveAgentActor:async()=>({userId:'owner',legacyTelegramId:42,whatsappId:fixtureUser.whatsappId,name:'Gogo'})},
  '@/lib/agent/content-workflow-entry':{tryRunContentWorkflow:async()=>null},
  '@/lib/bot/compound-shopping-friend':compound,
  '@/lib/commerce/comparison-model':{namesRetailerPriceRead},
  '@/lib/bot/handlers/friend-reminders':actual['@/lib/bot/handlers/friend-reminders'],
  '@/lib/commerce/price-comparison':{tryPriceComparison:async(params:any)=>{
    const parsed=parsePriceComparison(params.text)
    assert.ok(parsed)
    webClaims.push({...params,...parsed})
    if(failFlipkart&&parsed.providers.includes('flipkart'))throw Error('fixture provider failure')
    return {text:`Browser check queued: ${parsed.subject} on ${parsed.providers.join(', ')}`,handledBy:'price-comparison'}
  }},
  '@/lib/bot/process-message':{processIncomingMessage:exports.processIncomingMessage},
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(text:string)=>text},
  '@/lib/feature-intents':realFeature,
})
const postWeb=(text:string,origin='https://fixture.invalid')=>{
  const req=new Request('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({text})})
  return web.POST(Object.assign(req,{nextUrl:new URL(req.url)}))
}
const freshWeb="Check the price of iPhone 17 Pro 256GB on flipkart.com\nWhat's the price of Sony WH-1000XM5 on croma.com?"
const beforeWeb=featureClaims
for(const text of [freshWeb,combined]){
  pending=null;contacts.clear();webClaims.length=0;webHistory.length=0
  const response=await postWeb(text)
  assert.equal(response.status,200)
  const reply=await response.json()
  assert.equal(reply.handledBy,'compound-shopping-friend')
  assert.deepEqual(webClaims.map(row=>[row.subject,Array.from(row.providers),row.surface]),[
    ['iPhone 17 Pro 256GB',['flipkart'],'web'],['Sony WH-1000XM5',['croma'],'web'],
  ],'each product must keep its own retailer and web completion surface')
  assert.equal(webHistory.length,4,'save each price request and its own acknowledgement')
  if(text===combined){assert.match(reply.text,/Matthew.*WhatsApp number/i);assert.equal(pending?.stage,'number')}
  else assert.equal(pending,null)
  assert.equal(featureClaims,beforeWeb,'an upstream whole-message feature claim is a failure')
  assert.deepEqual(webhookErrors,[],'caught web route failures must fail the harness')
}
const createdBeforeWeb=created
const webNumber=await (await postWeb('+91 98765 43210')).json()
assert.match(webNumber.text,/confirm|YES/i)
assert.equal(created,createdBeforeWeb,'a supplied number must not bypass confirmation')
assert.equal(pending?.stage,'confirm')
const webConfirm=await (await postWeb('YES')).json()
assert.match(webConfirm.text,/Done.*remind Matthew.*11:00 am IST/)
assert.equal(created,createdBeforeWeb+1)
assert.equal(featureClaims,beforeWeb,'number and YES must continue the pending reminder, not another planner')
assert.deepEqual(webhookErrors,[])
failFlipkart=true;pending=null;contacts.clear();webClaims.length=0
const partialWeb=await (await postWeb(combined)).json()
assert.match(partialWeb.text,/resend that request separately/)
assert.match(partialWeb.text,/Sony WH-1000XM5 on croma/)
assert.match(partialWeb.text,/Matthew.*WhatsApp number/i)
assert.equal(webClaims.length,2,'a failed first store must not swallow the second store or reminder')
assert.equal(webhookErrors.length,1)
assert.equal(webhookErrors[0][0],'DASHBOARD_COMPOUND_STEP_FAILED:')
const writesBeforeAuth=webHistory.length
assert.equal((await postWeb(combined,'https://other.invalid')).status,403)
webSession=null
assert.equal((await postWeb(combined)).status,401)
assert.equal(webHistory.length,writesBeforeAuth,'compound handling must remain behind origin and session checks')
console.log('Actual web POST → separate product/retailer claims and friend clarification, partial failure and auth checks passed')
