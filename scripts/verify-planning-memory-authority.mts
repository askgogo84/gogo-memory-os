import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
// Execute the actual renderer/selector without database, model or provider access.
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/context-brain.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actual,require:(name:string)=>name==='@/lib/bot/memory-redaction'?{redactSecretShapedText:(text:string)=>text}:{},Date,Intl,console})
const query='Based on everything you already know about me, would 25 October 2026 around 8:30 PM be a good time for dinner in Bengaluru? Tell me what existing context matters.'
const fact=(id:string,summary:string,extra:any={})=>({id,source:'semantic_memory',summary,score:.95,confidence:.95,inferred:false,...extra})
const move=fact('move','Owner is moving house on 25 October 2026.')
const preference=fact('preference','Owner prefers quiet seating and vegetarian meals.')
const old=fact('old','Synthetic Guest arrives in Bengaluru on flight ZX123 on 13 October 2026.',{startAt:'2026-10-18T00:00:00Z'})
const failures:string[]=[]
function check(label:string,fn:()=>void){try{fn();console.log('PASS '+label)}catch(e:any){failures.push(label+': '+e.message)}}
check('dated semantic arrival cannot establish later owner or guest presence',()=>{
 const selected=actual.prioritizeRecallEvidence(query,[old,move,preference])
 assert.ok(!selected.some((f:any)=>f.id==='old'),'old semantic arrival survived into future planning')
 assert.equal(selected[0].id,'move');assert.ok(selected.some((f:any)=>f.id==='preference'))
})
check('different-year semantic itinerary is not a same-day commitment',()=>{
 for(const date of ['25 October 2027','25 October, 2027','October 25,2027','October 25, 2027']){
  const wrong=fact('wrong-year','Synthetic Guest has a flight on '+date+'.')
  assert.ok(!actual.prioritizeRecallEvidence(query,[wrong,move]).some((f:any)=>f.id==='wrong-year'),date)
 }
})
check('historical dinner question retains the earlier arrival it explicitly asks about',()=>{
 assert.ok(actual.prioritizeRecallEvidence('What dinner did I have on 25 October 2026 after the flight on 13 October 2026?',[old,move]).some((f:any)=>f.id==='old'))
})
check('historical recall preserves dated arrival and ordinary standing preferences',()=>{
 assert.ok(actual.prioritizeRecallEvidence('When did Synthetic Guest arrive on 13 October 2026?',[old,preference]).some((f:any)=>f.id==='old'))
 assert.ok(actual.prioritizeRecallEvidence(query,[preference]).some((f:any)=>f.id==='preference'))
})
check('matching recorded itinerary remains available without converting it into presence',()=>{
 const current=fact('current','Synthetic Guest has a flight on 25 October 2026.')
 assert.ok(actual.prioritizeRecallEvidence(query,[current,move]).some((f:any)=>f.id==='current'))
})
check('month-first matching itinerary remains available',()=>{
 const current=fact('month-first','Synthetic Guest has a flight on October 25, 2026.')
 assert.ok(actual.prioritizeRecallEvidence(query,[current,move]).some((f:any)=>f.id==='month-first'))
})
check('existing 2200-character renderer budget preserves a substantial matching fact',()=>{
 const substantial=fact('substantial',('Owner is moving house on 25 October 2026. '+('Packing the study is unfinished. '.repeat(18))).trim())
 const text=actual.renderContextBlock({query,generatedAt:'2026-10-19T00:00:00Z',facts:[substantial]},2200)
 assert.ok(text.includes(substantial.summary),'planning instructions crowded out the only saved fact')
})
check('rendered planning evidence does not promote an undated proposal into confirmation or freedom',()=>{
 const pending=fact('pending','Naru dinner proposal, awaiting approval.',{source:'open_loop'})
 const text=actual.renderContextBlock({query,generatedAt:'2026-10-19T00:00:00Z',facts:[old,move,pending,preference]},3200)
 assert.ok(!text.includes(old.summary));assert.ok(text.includes(move.summary));assert.ok(text.includes(pending.summary))
 assert.match(text,/proposal.*not.*confirmed|not.*confirmed.*proposal/i)
 assert.match(text,/moving.*not.*complete|completion.*not.*assume/i)
 assert.match(text,/calendar.*coverage|coverage.*calendar/i)
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}
