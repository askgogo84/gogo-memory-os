import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {
  isReminderReadQuery,
  normalizeNaturalReminderSave,
  parseListReminderCompound,
} from '../lib/bot/handlers/natural-command-routing.ts'
import { parseExplicitListShow } from '../lib/bot/handlers/list-conversation-context.ts'
import { canonicalFullWhatsAppNumber, isReminderDestinationOwner } from '../lib/services/reminder-recipient-owner.ts'

const compound = 'Create a list called Persistent Runtime Test with Passport, Charger and Power bank. Remind me tomorrow at 9:00 AM to review the Persistent Runtime Test list.'
const parsed = parseListReminderCompound(compound)
assert.ok(parsed, 'compound list+reminder command should be detected')
assert.equal(parsed?.listName, 'Persistent Runtime Test')
assert.deepEqual(parsed?.items, ['Passport', 'Charger', 'Power bank'])
assert.equal(parsed?.reminderText, 'Remind me tomorrow at 9:00 AM to review the Persistent Runtime Test list.')
assert.equal(normalizeNaturalReminderSave(compound), parsed?.reminderText)

assert.equal(parseExplicitListShow('Show me the list called Persistent Runtime Test.'), 'Persistent Runtime Test')
assert.equal(parseExplicitListShow('Open my grocery list'), 'grocery')

assert.equal(isReminderReadQuery('What reminders do I have for tomorrow?'), true)
assert.equal(isReminderReadQuery('Show me my reminders for tomorrow'), true)
assert.equal(isReminderReadQuery('Show my pending reminders.'),true)
assert.equal(isReminderReadQuery('List my upcoming reminders'),true)
assert.equal(isReminderReadQuery('Do I have any reminders today?'), true)
assert.equal(isReminderReadQuery('Remind me tomorrow at 9 AM to call Srinivas'), false)
assert.equal(isReminderReadQuery('Set a reminder tomorrow at 9 AM'), false)
assert.ok(normalizeNaturalReminderSave('What reminders do I have for tomorrow?'), 'read query must be intercepted before write routing')

assert.equal(parseListReminderCompound('Create a list called Test with A and B.'), null)
assert.equal(parseListReminderCompound('Remind me tomorrow at 9 AM to call Srinivas'), null)

// The actual production wording fell through to model prose, which called a
// past reminder upcoming. Exercise the real reader against owned saved rows.
const fixedNow=Date.parse('2026-10-07T12:40:00Z')
class FixtureDate extends Date {constructor(value?:any){super(value===undefined?fixedNow:value)}static now(){return fixedNow}}
const rows=[
 {id:'past',telegram_id:42,sent:false,message:'Past reminder',remind_at:'2026-10-06T10:35:00Z'},
 {id:'future',telegram_id:42,sent:false,message:'Tomorrow reminder',remind_at:'2026-10-08T03:30:00Z'},
 {id:'done',telegram_id:42,sent:true,message:'Completed reminder',remind_at:'2026-10-08T03:30:00Z'},
 {id:'other',telegram_id:43,sent:false,message:'Other owner reminder',remind_at:'2026-10-08T03:30:00Z'},
]
const database={from:(table:string)=>{
 const filters:Array<(r:any)=>boolean>=[]
 const q:any={select:()=>q,eq:(key:string,value:any)=>{filters.push(r=>r[key]===value);return q},order:()=>q,limit:()=>q,
  maybeSingle:async()=>({data:{timezone:'Asia/Kolkata'}}),then:(resolve:any)=>Promise.resolve({data:rows.filter(r=>filters.every(f=>f(r))),error:null}).then(resolve)}
 assert.ok(['users','reminders'].includes(table));return q
}}
const realReader:any={}
const reminderDedup=await import('../lib/bot/reminder-dedup')
runInNewContext(ts.transpileModule(readFileSync('lib/agent/compound-planner.ts','utf8')+'\nexport {readReminderQuery,isReminderReadQuery}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:realReader,Date:FixtureDate,Intl,console,require:(name:string)=>name==='@/lib/supabase-admin'?{supabaseAdmin:database}:name==='./typed-object-context'?{rememberTypedObjects:async()=>{}}:name==='@/lib/bot/reminder-dedup'?reminderDedup:{},
})
assert.equal(realReader.isReminderReadQuery('Show my pending reminders.'),true,'the deterministic planner claims the exact production request')
const pending=await realReader.readReminderQuery({legacyTelegramId:42},'Show my pending reminders.')
assert.match(pending,/Past reminder[^\n]*2026[^\n]*overdue/)
assert.match(pending,/Tomorrow reminder/)
assert.doesNotMatch(pending,/Completed reminder|Other owner reminder|UPCOMING/i)
const tomorrow=await realReader.readReminderQuery({legacyTelegramId:42},'Show my reminders for tomorrow')
assert.match(tomorrow,/Tomorrow reminder/,'tomorrow means the next local calendar day even after noon')
assert.doesNotMatch(tomorrow,/Past reminder/)
const upcoming=await realReader.readReminderQuery({legacyTelegramId:42},'Show my upcoming reminders')
assert.match(upcoming,/Tomorrow reminder/);assert.doesNotMatch(upcoming,/Past reminder/)

/**
 * P1 recipient/owner containment: a friend in a different country may have
 * the same last ten digits as the owner. The reminder cron must NOT turn that
 * friend's destination into an own reminder, particularly while F2F is OFF.
 * Exercise the actual cron helper with inert, owner-scoped database rows.
 */
assert.equal(canonicalFullWhatsAppNumber('whatsapp:+919876543210'), '919876543210')
assert.equal(canonicalFullWhatsAppNumber('919876543210'), '919876543210')
for (const unverified of [
  '9876543210', // domestic number requires an unverified country assumption
  'whatsapp:9876543210',
  '+91 9876543210',
  'whatsapp:+919876543210?to=another',
  'https://api.example/whatsapp:+919876543210',
  '+000000000000',
  '',
]) assert.equal(canonicalFullWhatsAppNumber(unverified), null, 'reject ambiguous/invalid phone identity: ' + unverified)
assert.equal(canonicalFullWhatsAppNumber(null), null)
assert.equal(isReminderDestinationOwner('+919876543210', 'whatsapp:919876543210'), true)
assert.equal(isReminderDestinationOwner('+919876543210', '+449876543210'), false, 'never treat distinct country codes as the same owner')
assert.equal(isReminderDestinationOwner('+14155552671', '+914155552671'), false, 'same final ten digits across +1 / +91 are different owners')
assert.equal(isReminderDestinationOwner('9876543210', '9876543210'), false, 'two legacy domestic values are not proof of shared owner')
assert.equal(isReminderDestinationOwner(null, '+919876543210'), false)

const deliveryCronSource=readFileSync('app/api/cron/reminders/route.ts','utf8')
assert.match(deliveryCronSource,/isReminderDestinationOwner\(data\?\.whatsapp_id, whatsappTo\)/,
  'real cron owner-vs-friend decision must call the exact full-identity helper')
assert.ok(deliveryCronSource.includes('!F2F_REMINDERS_ENABLED && !owner'),
  'friend delivery stays disabled by default without explicit product approval')
assert.ok(deliveryCronSource.includes('TWILIO_REMINDER_BUTTONS_CONTENT_SID && owner'),
  'friend recipients must not receive owner-only reminder controls')
const cronExports:any={}
let ownerWhatsapp:string|null='+919876543210'
let ownerLookups=0
const ownerDb={from(table:string){
  assert.equal(table,'users')
  const q:any={
    select(fields:string){assert.equal(fields,'whatsapp_id');return q},
    eq(key:string,value:any){assert.equal(key,'telegram_id');assert.equal(value,999);ownerLookups++;return q},
    maybeSingle:async()=>({data:ownerWhatsapp===null?null:{whatsapp_id:ownerWhatsapp},error:null}),
  }
  return q
}}
runInNewContext(ts.transpileModule(deliveryCronSource+'\nexport { reminderGoesToOwner }',{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{
  exports:cronExports,module:{exports:cronExports},process:{env:{}},URL,console,
  require:(name:string)=>name==='@/lib/supabase-admin'?{supabaseAdmin:ownerDb}
    :name==='@/lib/services/reminder-recipient-owner'?{isReminderDestinationOwner}
    :{},
})
const reminderOwnedBy=cronExports.reminderGoesToOwner as (reminder:any,to:string)=>Promise<boolean>
assert.equal(await reminderOwnedBy({telegram_id:999},'whatsapp:+919876543210'),true,'exact same full owner receives normal reminder')
assert.equal(await reminderOwnedBy({telegram_id:999},'+449876543210'),false,'cross-country suffix collision is a friend, not the owner')
ownerWhatsapp='+14155552671'
assert.equal(await reminderOwnedBy({telegram_id:999},'whatsapp:+914155552671'),false,'+1 / +91 collision must never bypass the disabled friend-delivery gate')
ownerWhatsapp='9876543210'
assert.equal(await reminderOwnedBy({telegram_id:999},'9876543210'),false,'legacy local number fails closed instead of inferring +91')
ownerWhatsapp=null
assert.equal(await reminderOwnedBy({telegram_id:999},'+919876543210'),false,'missing persisted owner identity fails closed')
assert.equal(await reminderOwnedBy({telegram_id:0},'+919876543210'),false,'missing owner ID never reads another owner')
assert.equal(ownerLookups,5,'only present owner IDs may initiate exact owner-scoped lookup')
console.log('PASS: real reminder cron owner/friend gate rejects cross-country suffix collisions without deliveries or DB writes')

console.log('verify-reminder-list-p0: PASS')
