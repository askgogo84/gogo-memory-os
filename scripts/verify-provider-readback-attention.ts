import assert from 'node:assert/strict'
import { isGmailVerificationQuery, readGmailSendVerification } from '../lib/agent/gmail-verification'
import { partitionAttentionRuns, currentWatcherIdeas } from '../lib/agent/attention-state'
import { supabaseAdmin } from '../lib/supabase-admin'

for(const t of ['Did Gmail actually send that message? Give me provider verification.', 'Verify that Gmail sent it', 'Show proof that the email was sent'])assert.equal(isGmailVerificationQuery(t),true)
for(const t of ['Send it','Draft an email saying I sent it','Stop the watcher'])assert.equal(isGmailVerificationQuery(t),false)
const grouped=partitionAttentionRuns([
 {id:'1',title:'Same title',status:'running'}, {id:'2',title:'Same title',status:'paused'},
 {id:'3',status:'queued'}, {id:'4',status:'waiting_approval'}, {id:'5',status:'outcome_unknown'},
 {id:'6',status:'completed'}, {id:'7',status:'watching'}, {id:'1',status:'running'},
])
assert.deepEqual(grouped.activeNow.map(r=>r.id),['1'])
assert.deepEqual(grouped.waitingContext.map(r=>r.id),['2','5'])
assert.deepEqual(grouped.incomplete.map(r=>r.id),['3'])
assert.deepEqual(grouped.pendingDecisions.map(r=>r.id),['4'])
const ideas=[{id:'stopped',source_refs:[{type:'watcher',id:'w1'}]},{id:'live',source_refs:[{type:'watcher',id:'w2'}]},{id:'other'}]
assert.deepEqual(currentWatcherIdeas(ideas,new Set(['w2'])).map(r=>r.id),['live','other'])

async function main(){
 const original=supabaseAdmin.from
 let run:any={id:'run-1',status:'outcome_unknown'}
 let receipt:any={metadata_json:{gmail_message_id:'exact-message',thread_id:'exact-thread'}}
 let providerCalls=0
 const filters:any[]=[]
 ;(supabaseAdmin as any).from=(table:string)=>{
  const chain:any={maybeSingle:async()=>({data:table==='agent_runs'?run:receipt,error:null})}
  for(const method of ['select','eq','in','order','limit'])chain[method]=(...args:any[])=>{filters.push([table,method,...args]);return chain}
  for(const method of ['insert','update','delete','upsert'])chain[method]=()=>{throw new Error('Verification query must never mutate state')}
  return chain
 }
 const params={actor:{legacyTelegramId:123} as any,text:'Did Gmail actually send that message?'}
 try {
  const verified=await readGmailSendVerification(params,async(messageId,threadId)=>{
   providerCalls++;assert.equal(messageId,'exact-message');assert.equal(threadId,'exact-thread');return {verified:true}
  })
  assert.equal(verified?.verification.verified,true)
  assert.match(verified!.text,/SENT label and the expected thread/)
  const missing=await readGmailSendVerification(params,async()=>({verified:false}))
  assert.equal(missing?.verification.verified,false)
  const unavailable=await readGmailSendVerification(params,async()=>{throw new Error('provider unavailable')})
  assert.match(unavailable!.text,/remains unverified/)
  receipt=null
  await readGmailSendVerification(params,async()=>{providerCalls++;return {verified:true}})
  assert.equal(providerCalls,1,'no provider receipt means no guessed message or fuzzy search')
  run=null
  assert.match((await readGmailSendVerification(params,async()=>({verified:true})))!.text,/no recorded Gmail send/)
  assert.ok(filters.some(f=>f[1]==='eq'&&f[2]==='telegram_id'&&f[3]==='123'))
 }finally{supabaseAdmin.from=original}
 console.log('Provider readback and Attention: exact IDs, no mutations/retries, unknown evidence, canonical state partition and stopped watcher retirement passed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
