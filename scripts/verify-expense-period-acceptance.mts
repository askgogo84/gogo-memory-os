import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const RealDate=Date
class FixedDate extends RealDate{constructor(value?:string|number){super(value===undefined?'2026-10-19T00:45:00Z':value)}static now(){return RealDate.parse('2026-10-19T00:45:00Z')}}
const records=[{amount:450,category:'Food',description:'test lunch',logged_at:'2026-10-18T19:00:00Z'},{amount:1200,category:'Transport',description:'test petrol',logged_at:'2026-10-19T00:30:00Z'},{amount:999,category:'Other',description:'previous week',logged_at:'2026-10-18T10:00:00Z'},{amount:9999,category:'Other',description:'future record',logged_at:'2026-10-20T10:00:00Z'}]
let fail=false,since='',until='',reads=0
const db={from:(table:string)=>{assert.equal(table,'expenses');let start='',end='';const q:any={select:()=>q,eq:(column:string,value:unknown)=>{assert.equal(column,'telegram_id');assert.equal(value,123);return q},gte:(_key:string,value:string)=>{start=since=value;return q},lte:(_key:string,value:string)=>{end=until=value;return q},order:()=>{reads++;return Promise.resolve(fail?{data:null,error:{message:'fixture read unavailable'}}:{data:records.filter(row=>row.logged_at>=start&&(!end||row.logged_at<=end)),error:null})}};return q}}
const actual:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/bot/services/expense-storage.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actual,require:(name:string)=>name==='@/lib/supabase-admin'?{supabaseAdmin:db}:{},Date:FixedDate,Intl,console})
const failures:string[]=[]
async function check(label:string,fn:()=>unknown){try{await fn();console.log('PASS '+label)}catch(e:any){failures.push(label+': '+e.message)}}
await check('this week means Monday local midnight through now, not a rolling seven days',async()=>{
 const result=await actual.getPeriodExpenses(123,'week')
 assert.equal(since,'2026-10-18T18:30:00.000Z');assert.equal(until,'2026-10-19T00:45:00.000Z');assert.equal(result.total,1650);assert.equal(result.count,2);assert.equal(result.entries.length,2)
})
await check('this month includes its entire first local day and excludes future records',async()=>{
 await actual.getPeriodExpenses(123,'month');assert.equal(since,'2026-09-30T18:30:00.000Z');assert.equal(until,'2026-10-19T00:45:00.000Z')
})
await check('unavailable records cannot become an authoritative empty or zero-spend result',async()=>{
 fail=true;try{await assert.rejects(()=>actual.getPeriodExpenses(123,'week'),/expense.*unavailable/i);await assert.rejects(()=>actual.getTodayExpenses(123),/expense.*unavailable/i)}finally{fail=false}
})
await check('all expense acceptance probes are reads with exact owner binding',()=>assert.ok(reads>=4))
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}
