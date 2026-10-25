import assert from 'node:assert/strict'
import { createCalendarEvent } from '../lib/services/google-calendar'
import { hasExecutionEvidence } from '../lib/agent/execution-evidence'
import { recordDecisionLearning } from '../lib/agent/decision-learning'
import { supabaseAdmin } from '../lib/supabase-admin'

async function main() {
  const oldFetch=globalThis.fetch,oldFrom=supabaseAdmin.from
  let read:any,posts=0,gets=0,written:any
  globalThis.fetch=(async(_url:any,options:any={})=>{
    if(options.method==='POST'){posts++;return new Response(JSON.stringify({id:'exact-event'}))}
    gets++;return new Response(JSON.stringify(read))
  }) as typeof fetch
  ;(supabaseAdmin as any).from=()=>({insert:async(row:any)=>{written=row;return {error:null}}})
  try {
    const valid={id:'exact-event',summary:'Fixture',start:{dateTime:'2026-10-01T10:00:00Z'},end:{dateTime:'2026-10-01T11:00:00Z'},location:'Fixture room'}
    for(const mismatch of [{id:'other'}, {summary:'other'}, {start:{dateTime:'2026-10-02T10:00:00Z'}},
      {end:{dateTime:'2026-10-01T12:00:00Z'}},{status:'cancelled'},{location:'other'}]) {
      read={...valid,...mismatch}
      const before=posts
      const result=await createCalendarEvent('fixture','Fixture',valid.start.dateTime,valid.end.dateTime,'Fixture room')
      assert.equal(result.verification,'unknown');assert.equal(posts,before+1,'verification failure never retries the POST')
    }
    read=valid
    assert.equal((await createCalendarEvent('fixture','Fixture',valid.start.dateTime,valid.end.dateTime,'Fixture room')).verification,'verified')
    assert.equal(posts,gets)
    const actor={legacyTelegramId:123} as any
    for(const handler of ['gmail-send','calendar-create','calendar-update','browser-command','travel-booking','payment','submit-form']){
      await recordDecisionLearning({actor,text:'fixture',domain:'other',handler,objectRef:'object',outcome:'verified_success',verified:true})
      assert.equal(written.metadata_json.outcome,'unknown',handler+' must reject boolean-only proof')
      assert.equal(written.metadata_json.verified,false)
    }
    const proof={source:'gmail' as const,kind:'provider_readback' as const,objectRef:'thread',providerRef:'message',verified:true}
    assert.equal(hasExecutionEvidence('gmail-send','other',proof),false)
    assert.equal(hasExecutionEvidence('calendar-create','thread',proof),false)
    await recordDecisionLearning({actor,text:'fixture',domain:'email',handler:'gmail-send',objectRef:'thread',outcome:'verified_success',verified:true,executionEvidence:proof})
    assert.equal(written.metadata_json.verified,true)
    assert.equal(written.metadata_json.verification_source,'gmail')
    assert.equal(hasExecutionEvidence('reminder-update','reminder'),null,'canonical CRUD remains a separate verification class')
  } finally { globalThis.fetch=oldFetch;supabaseAdmin.from=oldFrom }
  console.log('Execution evidence: Calendar exact fields, unknown no-retry, consequential boolean-only rejection and bound proof passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
