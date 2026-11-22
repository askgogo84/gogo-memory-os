// Inert original-function Gmail API regression: 12 mocked threads and one 429.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const src=readFileSync('lib/services/google-gmail.ts','utf8')
assert.match(src,/Math\.min\(3,threadIds\.length\)/)
assert.match(src,/if\(failed\|\|found\.some\(row=>row===null\)\)throw new Error\('gmail_attention_thread_read_incomplete'\)/)
assert.match(src,/console\.error\('Gmail attention thread fetch failed:',res\.status\)/,
 'never write private Gmail thread IDs into runtime error logs')
assert.match(src,/const settled=await Promise\.allSettled\(threadIds\.map\(id=>fetchAttentionThread\(accessToken,id\)\)\)/,
 'searchGmailThreads behavior is unchanged in this narrow patch')
const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const ids=Array.from({length:12},(_,i)=>'synthetic-thread-'+i)
async function run(failId:string|null){
 let concurrent=0,peak=0,requests:string[]=[],errors:string[]=[]
 const fetch=async(url:string)=>{
  const path=new URL(url).pathname
  if(path.endsWith('/messages'))return {ok:true,status:200,json:async()=>({messages:ids.map(threadId=>({threadId}))})}
  const id=decodeURIComponent(path.split('/').at(-1)!)
  assert.ok(ids.includes(id),'only fixture IDs can be fetched')
  requests.push(id);concurrent++;peak=Math.max(peak,concurrent)
  // Delays intentionally vary to exercise deterministic result ordering.
  await new Promise(resolve=>setTimeout(resolve,(12-ids.indexOf(id))%4+2))
  concurrent--
  if(id===failId)return {ok:false,status:429,json:async()=>({error:{code:429}})}
  return {ok:true,status:200,json:async()=>({id,messages:[{id:id+'-message',threadId:id,
   internalDate:'1700000000000',snippet:'fixture',labelIds:['INBOX'],
   payload:{headers:[{name:'Subject',value:'Fixture'},{name:'From',value:'Example <example@invalid.test>'}]}}]})}
 }
 const exp:any={}
 runInNewContext(compiled,{exports:exp,require:(name:string)=>require(name),
  fetch,URL,URLSearchParams,Buffer,process,Date,Promise,setTimeout,clearTimeout,
  console:{error:(...a:any[])=>errors.push(a.map(String).join(' ')),log:()=>{}}})
 const read=exp.fetchGmailAttentionThreads('synthetic-token',12)
 if(failId){
  await assert.rejects(read,/gmail_attention_thread_read_incomplete/,'a 429 must fail closed, not return partial success')
  assert.ok(requests.length<ids.length,'429 stops scheduling remaining provider reads')
  assert.ok(errors.every(s=>!s.includes('synthetic-thread-')),'no Gmail thread IDs in logs')
 }else{
  const result=await read
  assert.deepEqual(Array.from(result,(r:any)=>r.id),ids,'preserve requested thread order when responses finish out of order')
  assert.equal(requests.length,ids.length)
  assert.equal(errors.length,0)
 }
 assert.ok(peak<=3,'maximum concurrency must be three; observed '+peak)
 return peak
}
assert.equal(await run(null),3,'the bounded worker pool should use all three slots')
await run(ids[0])
console.log('PASS: Gmail attention reads max 3 in flight, ordered, fail closed and stop after 429; no real provider calls or ID logs')
