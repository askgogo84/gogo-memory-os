import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { activityObservationFromRun, safeActivityProviderUrl } from '../lib/openui/activity-observation'

const UUID = 'c615f10c-9071-43a5-9f67-7c175309b6c1'
const owner = '123'
const webRow = { title: 'Synthetic Court One', provider: 'playo.co', url: 'https://playo.co/venues/bengaluru/synthetic-court' }
const meta = {
  plan_type: 'appointment_research', service: 'badminton court', location: 'Indiranagar, Bengaluru',
  timing: 'Saturday morning', readOnly: true, mutated: false,
  options: [webRow, { title: 'Malicious Court', provider: 'playo.co', url: 'https://playo.co.evil.test/venue' }],
  private_phone: 'SECRET_PHONE_MUST_NOT_LEAK', request: 'PRIVATE_USER_CONTENT',
}
const run = { id: UUID, type: 'appointment_research', status: 'completed',
  updated_at: '2026-10-25T10:10:00Z', metadata_json: meta }
const step = { run_id: UUID, tool_name: 'web_search', status: 'completed',
  completed_at: '2026-10-25T10:09:00Z',
  output_json: { verifiedStore: 'public-web', locationStrict: true, mutated: false,
    options: [webRow, meta.options[1]] } }
const positive = activityObservationFromRun(run, [step])
assert(positive)
assert.equal(positive.status, 'discovered')
assert.equal(positive.venues.length, 1, 'only provider-allowlisted exact-evidence item is shown')
assert.equal(positive.venues[0].title, 'Synthetic Court One')
assert.equal(positive.venues[0].sourceUrl, webRow.url)
assert.equal(positive.observedAt, new Date(step.completed_at).toISOString(), 'evidence timestamps use canonical UTC ISO')
assert.match(positive.notice, /not live availability/i)
assert.doesNotMatch(JSON.stringify(positive), /SECRET_PHONE_MUST_NOT_LEAK|PRIVATE_USER_CONTENT|priceInr/)
assert.equal(activityObservationFromRun({...run, metadata_json: {...meta,service:'dermatologist'}},[step]),null,
  'medical and non-sports appointment research must not be exposed')
assert.equal(activityObservationFromRun({...run, metadata_json: {...meta,readOnly:false}},[step]),null)
assert.equal(activityObservationFromRun({...run, type:'generic_agent'},[step]),null)
assert.equal(activityObservationFromRun({...run, id:'bad'},[step]),null)
assert.equal(activityObservationFromRun({...run, metadata_json:{...meta,options:[]}},[step])?.venues.length,0,
  'saved run and web-search receipt must match exactly')
assert.equal(activityObservationFromRun(run,[{...step,run_id:'other'}])?.venues.length,0)
assert.equal(activityObservationFromRun(run,[{...step,output_json:{...step.output_json,verifiedStore:'model-suggestion'}}])?.venues.length,0)
assert.equal(activityObservationFromRun(run,[{...step,status:'running'}])?.venues.length,0)
assert.equal(activityObservationFromRun({...run,status:'running'},[step])?.venues.length,0,
  'no cards from an in-progress run')
for(const link of [
  'http://playo.co/venues/a', 'https://playo.co.evil.test/venues/a',
  'https://user:pass@playo.co/venues/a', 'https://hudle.in/a?session=secret',
  'https://hudle.in/a#private', 'javascript:alert(1)', 'https://evil.test/venues/a',
]) assert.equal(safeActivityProviderUrl(link),null, 'deny unsafe provider URL '+link)
assert.equal(safeActivityProviderUrl('https://hudle.in/venues/synthetic'), 'https://hudle.in/venues/synthetic')

const route = readFileSync('app/api/openui/activities/[id]/route.ts', 'utf8')
assert.match(route, /requireAgentSession\(request\)/)
assert.match(route, /isAgentSession\(session\)/)
assert.match(route, /\.eq\('telegram_id', owner\)/g)
assert.match(route, /\.eq\('run_id', id\)/)
assert.match(route, /\.eq\('type', 'appointment_research'\)/)
assert.match(route, /\.eq\('tool_name', 'web_search'\)/)
assert.match(route, /private, no-store/)
assert.doesNotMatch(route, /\.insert\(|\.update\(|\.delete\(|\.rpc\(/, 'GET must be read-only')
const ui = readFileSync('components/dashboard/openui-activity-results.tsx', 'utf8')
assert.match(ui, /Provider discovery only/)
assert.match(ui, /A provider link is not a confirmed booking/)
assert.match(ui, /do not send it/)
assert.doesNotMatch(ui, /method:\s*['"]POST['"]|bookSlot\(|payFor\(|submitBooking\(/i)
const page = readFileSync('app/dashboard/(app)/activity-results/[id]/page.tsx','utf8')
assert.match(page, /credentials: 'same-origin'/)
assert.match(page, /cache: 'no-store'/)
assert.match(page, /30000/)
const activity = readFileSync('app/dashboard/(app)/activity/[runId]/page.tsx','utf8')
assert.match(activity, /dashboard\/activity-results\//)

// Execute the real transpiled GET in an inert VM, with owner-bound in-memory fixtures.
{
  let currentOwner = owner
  let authenticated = true
  let failRead = false
  let reads = 0, mutations = 0
  const fake = {
    from(table:string) {
      assert.ok(['agent_runs','agent_steps'].includes(table))
      reads++
      const filters: Array<(row: Record<string,unknown>)=>boolean> = []
      const query:any = {
        select: () => query,
        eq: (field:string,value:unknown) => {filters.push(row=>String(row[field])===String(value)); return query},
        order: () => query,
        maybeSingle: async () => failRead ? {data:null,error:{message:'unavailable'}} :
          {data:filters.every(f=>f({...run,telegram_id:owner}))?run:null,error:null},
        limit: async () => failRead ? {data:[],error:{message:'unavailable'}} :
          {data:filters.every(f=>f({...step,telegram_id:owner}))?[step]:[],error:null},
        insert: ()=>{mutations++;throw Error('mutations forbidden')},
        update: ()=>{mutations++;throw Error('mutations forbidden')},
        delete: ()=>{mutations++;throw Error('mutations forbidden')},
      }
      return query
    },
  }
  const mod:any = {exports:{}}
  runInNewContext(ts.transpileModule(route,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports:mod.exports,
    require:(name:string)=>{
      if(name==='next/server')return{NextResponse:{json:(body:any,opts:any={})=>({
        status:opts.status||200,body,headers:opts.headers||{},
      })}}
      if(name==='@/lib/agent/session')return{
        requireAgentSession:async()=>authenticated?{telegramId:currentOwner}:{status:401,body:{error:'unauthorized'}},
        isAgentSession:(s:any)=>s?.telegramId!==undefined,
      }
      if(name==='@/lib/supabase-admin')return{supabaseAdmin:fake}
      if(name==='@/lib/openui/activity-observation')return{activityObservationFromRun}
      throw Error('Unexpected route dependency: '+name)
    },
    URL, Date, console, String, Array,
  })
  const GET = mod.exports.GET as (request:Request,ctx:any)=>Promise<any>
  const context = (id:string)=>({params:Promise.resolve({id})})
  let r = await GET(new Request('https://synthetic.invalid/api/openui/activities/'+UUID),context(UUID))
  assert.equal(r.status,200)
  assert.equal(r.body.venues.length,1)
  assert.equal(r.headers['Cache-Control'],'private, no-store')
  currentOwner='456'
  r=await GET(new Request('https://synthetic.invalid/api/openui/activities/'+UUID),context(UUID))
  assert.equal(r.status,404,'cross-tenant saved run not discoverable')
  authenticated=false
  const seen=reads
  r=await GET(new Request('https://synthetic.invalid/api/openui/activities/'+UUID),context(UUID))
  assert.equal(r.status,401)
  assert.equal(reads,seen,'unauthenticated request cannot query storage')
  authenticated=true;currentOwner=owner
  r=await GET(new Request('https://synthetic.invalid/api/openui/activities/bad'),context('bad'))
  assert.equal(r.status,400)
  failRead=true
  r=await GET(new Request('https://synthetic.invalid/api/openui/activities/'+UUID),context(UUID))
  assert.equal(r.status,503,'database outage is not a successful empty result')
  assert.equal(mutations,0)
}
console.log('OPENUI-ACTIVITY-04: owner, source, no-fake-inventory, and read-only GET contracts PASS (synthetic)')
