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
runInNewContext(ts.transpileModule(readFileSync('lib/agent/compound-planner.ts','utf8')+'\nexport {readReminderQuery,isReminderReadQuery}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:realReader,Date:FixtureDate,Intl,console,require:(name:string)=>name==='@/lib/supabase-admin'?{supabaseAdmin:database}:name==='./typed-object-context'?{rememberTypedObjects:async()=>{}}:{},
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
console.log('verify-reminder-list-p0: PASS')
