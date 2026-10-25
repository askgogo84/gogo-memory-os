import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { diningObservationFromRun, safeDiningProviderUrl } from '../lib/openui/dining-observation'

const UUID='6d84d990-8888-4d20-9fc7-e331c73a2011'
const NOW=new Date('2026-10-25T10:00:00.000Z')
const slotRun={
  id:UUID,type:'restaurant_reservation_slot',status:'paused',
  updated_at:'2026-10-25T09:57:00.000Z',
  metadata_json:{
    plan_type:'restaurant_reservation_slot',stage:'guest_name',
    restaurant:'Synthetic Toit',party_size:2,requested_date:'2026-10-28',
    preferred_start:'19:00',preferred_end:'21:00',
    provider:{url:'https://widget.reservego.co/toit-indiranagar',title:'Synthetic widget',firstParty:true},
    evidence:'ReserveGo times for 2026-10-28: 19:00, 19:30, 20:00',
    observed_slots:['19:00','19:30','20:00','garbage','19:00'],
    guest_name:'SECRET_NOT_FOR_UI',whatsapp_id:'PRIVATE_PHONE_NOT_FOR_UI',
  },
}
const positive=diningObservationFromRun(slotRun,NOW)
assert(positive)
assert.equal(positive.restaurant,'Synthetic Toit')
assert.equal(positive.partySize,2)
assert.equal(positive.requestedDate,'2026-10-28')
assert.equal(positive.requestedWindow,'19:00–21:00')
assert.deepEqual(positive.observedSlots,['19:00','19:30','20:00'])
assert.equal(positive.status,'historical_slots')
assert.match(positive.note,/not guaranteed|recheck/i)
assert.doesNotMatch(JSON.stringify(positive),/SECRET_NOT_FOR_UI|PRIVATE_PHONE_NOT_FOR_UI/)
assert.equal(positive.sourceUrl,'https://widget.reservego.co/toit-indiranagar')
const old=diningObservationFromRun({...slotRun,updated_at:'2026-10-24T08:00:00Z'},NOW)
assert.match(old?.note||'',/Past slot observation/)
assert.deepEqual(diningObservationFromRun({...slotRun,metadata_json:{...slotRun.metadata_json,evidence:'Open 7 PM to 11 PM'}},NOW)?.observedSlots,[],
  'generic opening hours never become available slots')
assert.deepEqual(diningObservationFromRun({...slotRun,metadata_json:{...slotRun.metadata_json,requested_date:'2026-10-29'}},NOW)?.observedSlots,[],
  'slots from a different date must never appear')
assert.deepEqual(diningObservationFromRun({...slotRun,metadata_json:{...slotRun.metadata_json,provider:{...slotRun.metadata_json.provider,firstParty:false}}},NOW)?.observedSlots,[],
  'not independently first-party verified')
assert.deepEqual(diningObservationFromRun({...slotRun,metadata_json:{...slotRun.metadata_json,provider:{url:'https://evil.test/reserve',firstParty:true}}},NOW)?.observedSlots,[],
  'malicious host is rejected')
assert.equal(diningObservationFromRun({...slotRun,type:'generic_agent'},NOW),null)
assert.equal(diningObservationFromRun({...slotRun,metadata_json:{...slotRun.metadata_json,plan_type:'another_plan'}},NOW),null)

const research=diningObservationFromRun({id:UUID,type:'restaurant_reservation_research',status:'completed',
 updated_at:'2026-10-25T09:00:00Z',metadata_json:{plan_type:'restaurant_reservation_research',
 restaurant:'Synthetic Naru',party_size:2,requested_date:'2026-10-28',preferred_start:'20:30',preferred_end:'20:30',
 observed_slots:['20:30'],provider:{url:'https://widget.reservego.co/reserve',firstParty:true},
 evidence:'ReserveGo times for 2026-10-28: 20:30'}},NOW)
assert.deepEqual(research?.observedSlots,[],'completed background research does not prove a table was available')
assert.equal(research?.status,'needs_review')
for(const url of [
  'https://reservego.co.evil.test/widget',
  'http://widget.reservego.co/widget',
  'https://user:pass@widget.reservego.co/widget',
  'https://localhost/widget',
  'javascript:alert(1)',
])assert.equal(safeDiningProviderUrl(url),null,'unsafe booking source refused: '+url)
assert.equal(safeDiningProviderUrl('https://widget.reservego.co/widget?token=secret'),null,
  'reject provider links with unreviewed session or outlet query parameters')

const route=readFileSync('app/api/openui/dining/[id]/route.ts','utf8')
assert.match(route,/requireAgentSession\(request\)/)
assert.match(route,/isAgentSession\(session\)/)
assert.match(route,/\.eq\('id',id\)/)
assert.match(route,/\.eq\('telegram_id',String\(session.telegramId\)\)/)
assert.match(route,/\.in\('type',\['restaurant_reservation_slot','restaurant_reservation_research'\]\)/)
assert.match(route,/private, no-store/)
assert.doesNotMatch(route,/insert\(|update\(|delete\(|\.rpc\(/,'dining view must not mutate database')
const ui=readFileSync('components/dashboard/openui-dining-results.tsx','utf8')
assert.match(ui,/Not a booking or a real-time availability check/)
assert.match(ui,/Selecting a slot prepares a read-only question/)
assert.doesNotMatch(ui,/method:\s*['"]POST['"]|fetch\(|bookTable\(|completeBooking\(|submitBooking\(/)
const page=readFileSync('app/dashboard/(app)/dining-results/[id]/page.tsx','utf8')
assert.match(page,/\/api\/openui\/dining\//)
assert.match(page,/credentials:'same-origin'/)
const activity=readFileSync('app/dashboard/(app)/activity/[runId]/page.tsx','utf8')
assert.match(activity,/\/dashboard\/dining-results\//)
// Exercise the real route with inert session + database fixtures: no production I/O.
{
  let owner='123', authenticated=true, databaseError=false
  let reads=0, mutations=0
  const ownedRow={...slotRun}
  const db={
    from(table:string){
      assert.equal(table,'agent_runs')
      reads++
      const filters:Array<(v:any)=>boolean>=[]
      const q:any={
        select:()=>q,
        eq:(field:string,value:any)=>{filters.push(r=>String(r[field])===String(value));return q},
        in:(field:string,values:string[])=>{filters.push(r=>values.includes(String(r[field])));return q},
        maybeSingle:async()=>databaseError?{data:null,error:{message:'synthetic failure'}}:
          {data:filters.every(test=>test({...ownedRow,telegram_id:'123'}))?ownedRow:null,error:null},
        update:()=>{mutations++;throw Error('no mutation allowed')},
        insert:()=>{mutations++;throw Error('no mutation allowed')},
        delete:()=>{mutations++;throw Error('no mutation allowed')},
      }
      return q
    },
  }
  const mod:any={exports:{}}
  const routeTs=ts.transpileModule(route,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  runInNewContext(routeTs,{
    exports:mod.exports,
    require:(name:string)=>{
      if(name==='next/server')return{NextResponse:{json:(value:any,options:any={})=>({
        status:options.status||200,body:value,headers:options.headers||{},
      })}}
      if(name==='@/lib/agent/session')return{
        requireAgentSession:async()=>authenticated?{telegramId:owner}:{status:401,body:{error:'unauthorized'}},
        isAgentSession:(s:any)=>s?.telegramId!==undefined,
      }
      if(name==='@/lib/supabase-admin')return{supabaseAdmin:db}
      if(name==='@/lib/openui/dining-observation')return{diningObservationFromRun}
      throw Error('unexpected route dependency '+name)
    },
    Date,URL,console,Array,String,
  })
  const GET=mod.exports.GET as (request:Request,ctx:any)=>Promise<any>
  const context=(id:string)=>({params:Promise.resolve({id})})
  let response=await GET(new Request('https://fixture.invalid/api/openui/dining/'+UUID),context(UUID))
  assert.equal(response.status,200)
  assert.deepEqual(response.body.observedSlots,['19:00','19:30','20:00'])
  assert.equal(response.headers['Cache-Control'],'private, no-store')
  const seen=reads
  owner='456'
  response=await GET(new Request('https://fixture.invalid/api/openui/dining/'+UUID),context(UUID))
  assert.equal(response.status,404,'another authenticated user cannot access the same run')
  authenticated=false
  response=await GET(new Request('https://fixture.invalid/api/openui/dining/'+UUID),context(UUID))
  assert.equal(response.status,401,'signed-out request fails before DB lookup')
  assert.equal(reads,seen+1,'unauthorized request makes zero further queries')
  authenticated=true;owner='123'
  response=await GET(new Request('https://fixture.invalid/api/openui/dining/invalid'),context('invalid'))
  assert.equal(response.status,400,'invalid run ID fails before DB lookup')
  databaseError=true
  response=await GET(new Request('https://fixture.invalid/api/openui/dining/'+UUID),context(UUID))
  assert.equal(response.status,503,'database error must never appear as empty success')
  assert.equal(mutations,0,'no database writes, ever')
}

console.log('OPENUI-DINING-03: source, identity, historical-slot and read-only contracts PASS (synthetic)')
