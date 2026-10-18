import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
const source=readFileSync('lib/agent/autonomy-status.ts','utf8')
const queries:Array<{table:string;columns:string;owner:unknown}>=[]
let fail=false
const db={from:(table:string)=>{
 const entry={table,columns:'',owner:null as unknown};queries.push(entry)
 const q:any={select:(columns:string)=>{entry.columns=columns;assert.doesNotMatch(columns,/token|password|secret/);return q},eq:(key:string,value:unknown)=>{assert.ok(['telegram_id','capability','sender'].includes(key));if(key==='telegram_id'){assert.equal(String(value),'123');entry.owner=value}if(key==='sender')assert.equal(value,'fixture-owner');return q},gte:()=>q,maybeSingle:()=>q,then:(resolve:any)=>resolve(fail?{data:null,error:{message:'fixture-down'},count:null}:{error:null,count:table==='vault_credentials'?2:table==='travel_tickets'?1:null,data:table==='users'?{gmail_connected:true,gmail_send_connected:false,google_calendar_connected:true,whatsapp_id:'fixture-owner'}:table==='agent_permissions'?{level:'read'}:table==='user_consent_settings'?{gmail_enabled:false}:table==='wa_creditiq_links'?{consumer_user_id:'fixture-linked'}:null})}
 return q
}}
const actual:any={}
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actual,require:(name:string)=>name==='@/lib/supabase-admin'?{supabaseAdmin:db}:{},Date,Intl,console})
const prompt='Show my connected services, their actual connection status, supported actions and which actions need my approval. Do not connect, disconnect or change anything.'
const failures:string[]=[]
async function check(label:string,fn:()=>unknown){try{await fn();console.log('PASS '+label)}catch(e:any){failures.push(label+': '+e.message)}}
await check('first20 service query is a deterministic private-state read',()=>assert.equal(actual.isConnectionCapabilityQuery?.(prompt),true))
await check('seven-service response reads owner-bound state without secrets or mutations',async()=>{
 const result=await actual.tryGetConnectionCapabilities({actor:{legacyTelegramId:123,whatsappId:'fixture-owner'},text:prompt})
 for(const name of ['Google Calendar','Gmail','Google Drive','Secure Browser','Vault','Travel context','CreditIQ'])assert.ok(result.text.includes(name),name)
 assert.match(result.text,/privacy.*off|reading.*off/i);assert.match(result.text,/approval/i);assert.match(result.text,/not.*health|health.*not/i)
 assert.equal(result.readOnly,true);assert.equal(result.mutated,false)
 assert.ok(queries.length>=5);assert.ok(queries.every(q=>q.table==='wa_creditiq_links'||String(q.owner)==='123'))
})
await check('read errors return unknown states without model fallback or false disconnection',async()=>{
 fail=true;try{const result=await actual.tryGetConnectionCapabilities({actor:{legacyTelegramId:123},text:prompt});assert.match(result.text,/unavailable|unknown/i);assert.doesNotMatch(result.text,/not connected|no saved logins|no upcoming tickets/i)}finally{fail=false}
})
await check('connection commands and mixed changes cannot be claimed as a completed read',async()=>{
 for(const text of ['Connect my Gmail','Disconnect my services','Show my connected services and disconnect Gmail']){
  assert.equal(actual.isConnectionCapabilityQuery?.(text),false);assert.equal(await actual.tryGetConnectionCapabilities({actor:{legacyTelegramId:123},text}),null)
 }
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}
