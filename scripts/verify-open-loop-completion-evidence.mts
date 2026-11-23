import assert from 'node:assert/strict'
import './verify-who-promised-oct27.mts'
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
// 23 Nov: reported or claimed completion is not owner-observed completion evidence.
// Check the classifier itself (RED on the old implementation) and the actual DB writer below.
const secondhandClaims=[
 'Vendor claimed the corrected JSON was delivered.',
 'Vendor claims the corrected JSON was sent.',
 'Vendor reportedly sent the corrected JSON.',
 'Vendor says the corrected JSON was delivered.',
 'Vendor told me they sent the corrected JSON.',
 'Vendor allegedly delivered the corrected JSON.',
]
for(const text of secondhandClaims){
 assert.equal(actual.isUncertainOrNegatedCompletion(text),true,text+' should not count as owner-verified completion')
}
assert.equal(actual.isUncertainOrNegatedCompletion('Vendor delivered the corrected JSON.'),false,'direct owner report can still resolve')
for(const text of ['I received the quarterly reports from Vendor.','I received the insurance claim document from Vendor.']){
 assert.equal(actual.isUncertainOrNegatedCompletion(text),false,text+' is a direct owner receipt, not hearsay')
}

for(const text of [
 'The corrected JSON from Vendor is not received.',
 ...secondhandClaims,
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
 'The corrected JSON from Vendor is yet to be received.',
 'Vendor is going to have delivered the corrected JSON by tomorrow.',
 'Vendor sent nothing for the corrected JSON.',
 'Vendor failed to send the corrected JSON.',
 'Nothing was received from Vendor for the corrected JSON.',
 'None of the corrected JSON from Vendor has been received.',
 'No corrected JSON request from Vendor was resolved.',
 'The corrected JSON from Vendor remains undelivered.',
]){
 for(const jev of [null,{ok:true,attentionState:{choice:'completed',confidence:0.99}}]){
  writes.length=0
  const result=await actual.autoResolveOpenLoopsFromTurn({actor,text,jev})
  if(result.length||writes.length)failures.push(`${text} semantic=${Boolean(jev)} incorrectly resolved a pending item`)
 }
}
for(const text of ['Vendor sent the corrected JSON.','Vendor delivered the corrected JSON.','I received the corrected JSON from Vendor.','No worries, Vendor sent the corrected JSON.','Vendor sent the corrected JSON. No further action is needed.','Vendor delivered the pending corrected JSON.']){
 writes.length=0
 const result=await actual.autoResolveOpenLoopsFromTurn({actor,text})
 if(result.length!==1||writes.length!==1||writes[0]?.status!=='resolved')failures.push(`${text} incorrectly blocked clear completion`)
}
// Preserve affirmative receipts when the deliverable itself is named reports or a claim.
for(const [title,completedText] of [
 ['Waiting on Vendor to send quarterly reports','I received the quarterly reports from Vendor.'],
 ['Waiting on Vendor to send insurance claim document','I received the insurance claim document from Vendor.'],
] as const){
 rows=[{...fixture,title,summary:title}]
 writes.length=0
 const result=await actual.autoResolveOpenLoopsFromTurn({actor,text:completedText})
 assert.equal(result.length,1,completedText+' must resolve the named, unambiguous loop')
 assert.equal(writes.length,1,completedText+' updates once only')
 assert.equal(writes[0]?.status,'resolved',completedText+' is affirmative owner evidence')
}
rows=[fixture,{...fixture,id:'synthetic-other',title:'Waiting on Vendor to send corrected JSON',summary:'Waiting for corrected JSON'}]
writes.length=0
assert.equal((await actual.autoResolveOpenLoopsFromTurn({actor,text:'Vendor sent the corrected JSON.'})).length,0)
assert.equal(writes.length,0,'Ambiguous target stays open')
assert.deepEqual(failures,[],'Only affirmative completion evidence may resolve an unambiguous item, regardless of a conflicting semantic guess')
console.log('Actual open-loop completion export: negative/uncertain/future evidence stays open; clear completion and ambiguity controls pass. Synthetic data only.')
