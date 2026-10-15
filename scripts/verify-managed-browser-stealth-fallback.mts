import assert from 'node:assert/strict'
import {resolveManagedSession,type ManagedState} from '../lib/agent/managed-browser'
// 15 Oct live: GOGO_BROWSER_ADVANCED_STEALTH=1 on a plan without it made Browserbase answer 403, every run failed, and the
// 403 left the user's state "pending" so later runs failed too. Run: npx tsx scripts/verify-managed-browser-stealth-fallback.mts
const project='11111111-1111-4111-8111-111111111111', context='22222222-2222-4222-8222-222222222222', sessionId='33333333-3333-4333-8333-333333333333'
const env={BROWSERBASE_API_KEY:'fixture-only',BROWSERBASE_PROJECT_ID:project,GOGO_BROWSER_ADVANCED_STEALTH:'1'}
let state:ManagedState|null=null, requests:Array<{path:string;body:any}>=[], running:any[]=[], stealthAllowed=false
const store={load:async()=>state&&structuredClone(state),save:async(v:ManagedState)=>{state=structuredClone(v)}}
const fetcher:typeof fetch=async(url,init)=>{
  const path=String(url).split('/v1/')[1],body=init?.body?JSON.parse(String(init.body)):null
  requests.push({path,body})
  if(path==='contexts')return new Response(JSON.stringify({id:context,projectId:project}))
  if(path.startsWith('sessions?status=RUNNING'))return new Response(JSON.stringify(running))
  if(path==='sessions'){
    if(body.browserSettings.advancedStealth&&!stealthAllowed)return new Response('{}',{status:403})
    return new Response(JSON.stringify({id:sessionId,projectId:project,contextId:body.browserSettings.context.id,userMetadata:body.userMetadata,status:'RUNNING',expiresAt:new Date(Date.now()+1200000).toISOString(),connectUrl:'wss://connect.apse1.browserbase.com/?secret=fixture'}))
  }
  if(path===`sessions/${sessionId}`)return new Response(JSON.stringify({id:sessionId,projectId:project,contextId:context,status:'COMPLETED'}))
  throw Error('unexpected '+path)
}

// 1. No stealth on the plan: one 403, then a normal session; the run works.
const s=await resolveManagedSession('owner-a','https://www.amazon.in/',store,env,fetcher)
assert.equal(s.newSession,true)
const creates=requests.filter(r=>r.path==='sessions')
assert.equal(creates.length,2)
assert.equal(creates[0].body.browserSettings.advancedStealth,true)
assert.equal(creates[1].body.browserSettings.advancedStealth,undefined)
assert.equal(state!.pending,undefined)

// 2. A user left "pending" by the old 403 is cleared once Browserbase shows no running session of theirs.
state={owner:state!.owner,contexts:state!.contexts,pending:'session'} as any; requests=[]
await resolveManagedSession('owner-a','https://www.amazon.in/',store,{...env,GOGO_BROWSER_ADVANCED_STEALTH:''},fetcher)
assert.match(requests[0].path,/^sessions\?status=RUNNING&q=user_metadata/)
assert.equal(state!.pending,undefined)

// 3. If a running session of theirs exists, the pending guard still holds (never two writers on one Context).
state={owner:state!.owner,contexts:state!.contexts,pending:'session'} as any
running=[{id:sessionId,userMetadata:{owner:state!.owner}}]
await assert.rejects(resolveManagedSession('owner-a','https://www.amazon.in/',store,env,fetcher),/managed_browser_setup_outcome_unknown/)
// ...and an unreadable list keeps it too.
running={} as any
await assert.rejects(resolveManagedSession('owner-a','https://www.amazon.in/',store,env,fetcher),/managed_browser_setup_outcome_unknown/)
console.log('verify-managed-browser-stealth-fallback: ok')
