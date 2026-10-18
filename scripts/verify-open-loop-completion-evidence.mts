import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

// Actual auto-resolution export, with an inert owner-checked synthetic database.
// The test cannot contact Gmail, send messages, or mutate production records.
const writes: Array<Record<string,unknown>> = []
const fixture={id:'synthetic-loop',kind:'waiting_on',title:'Waiting on Vendor to send corrected JSON',summary:'Waiting for corrected JSON',source_type:'gmail_thread'}
let rows=[fixture]
const db={from(table:string){
 if(table==='agent_activity')return {insert:async()=>({error:null})}
 assert.equal(table,'agent_open_loops')
 const q={select:()=>q,eq:(key:string,value:unknown)=>{if(key==='telegram_id')assert.equal(value,'123');return q},in:()=>q,order:()=>q,
  limit:async()=>({data:rows,error:null}),update:(payload:Record<string,unknown>)=>{writes.push(payload);return q},then:(resolve:(value:unknown)=>unknown)=>resolve({error:null})}
 return q
}}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/open-loops.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
 {exports:actual,require:(name:string)=>name==='@/lib/supabase-admin'?{supabaseAdmin:db}:{},console,Date,Set,Map})
const actor={legacyTelegramId:123}
const failures:string[]=[]
for(const text of [
 'The corrected JSON from Vendor is not received.',
 "The corrected JSON from Vendor isn't received.",
 'The corrected JSON from Vendor isn’t received.',
 'The corrected JSON from Vendor was not received.',
 'The corrected JSON from Vendor has not been received.',
 'Vendor never sent the corrected JSON.',
 'Vendor might have delivered the corrected JSON.',
 'Vendor may have delivered the corrected JSON.',
 'Vendor could have delivered the corrected JSON.',
 'Vendor will have delivered the corrected JSON tomorrow.',
 'Vendor should have delivered the corrected JSON.',
 'Perhaps Vendor delivered the corrected JSON.',
 'I am not sure Vendor delivered the corrected JSON.',
 'Did Vendor send the corrected JSON?',
 "Vendor hasn't sent the corrected JSON yet.",
 'No corrected JSON was received from Vendor.',
 'I received no corrected JSON from Vendor.',
 'I think Vendor delivered the corrected JSON.',
 'It seems Vendor delivered the corrected JSON.',
 'Vendor apparently delivered the corrected JSON.',
]){
 for(const jev of [null,{ok:true,attentionState:{choice:'completed',confidence:0.99}}]){
  writes.length=0
  const result=await actual.autoResolveOpenLoopsFromTurn({actor,text,jev})
  if(result.length||writes.length)failures.push(`${text} semantic=${Boolean(jev)} incorrectly resolved a pending item`)
 }
}
assert.deepEqual(failures,[],'Negative/uncertain/future statements cannot prove completion, even with a conflicting semantic guess')
for(const text of ['Vendor sent the corrected JSON.','Vendor delivered the corrected JSON.','I received the corrected JSON from Vendor.']){
 writes.length=0
 const result=await actual.autoResolveOpenLoopsFromTurn({actor,text})
 assert.equal(result.length,1,text)
 assert.equal(writes.length,1)
 assert.equal(writes[0].status,'resolved')
}
rows=[fixture,{...fixture,id:'synthetic-other',title:'Waiting on Vendor to send corrected JSON',summary:'Waiting for corrected JSON'}]
writes.length=0
assert.equal((await actual.autoResolveOpenLoopsFromTurn({actor,text:'Vendor sent the corrected JSON.'})).length,0)
assert.equal(writes.length,0,'Ambiguous target stays open')
console.log('Actual open-loop completion export: negative/uncertain/future evidence stays open; clear completion and ambiguity controls pass. Synthetic data only.')
