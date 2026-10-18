import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL='https://auth-fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only'
process.env.OPENAI_API_KEY='fixture-only'
process.env.ANTHROPIC_API_KEY='fixture-only'
const {otpReply}=await import('../lib/agent/provider-booking')
const {runSecureBrowser}=await import('../lib/agent/secure-computer')
const worker=await import('../lib/agent/approved-browser-worker')
const notice=await import('../lib/agent/browser-auth-notice')
const fetchBefore=globalThis.fetch
let io=0
try{
 globalThis.fetch=async()=>{io++;throw Error('Unexpected provider I/O')}
 for(const field of ['loginCode','bookingOtp'])await assert.rejects(runSecureBrowser({userId:'fixture',url:'https://example.com',objective:'read only',mode:'read',[field]:'482913'}),/human_auth_takeover_required/)
 for(const fn of [worker.runBookingOtpResume,worker.runLoginCodeResume,worker.triggerBookingOtpResume,worker.triggerLoginCodeResume])await assert.rejects(fn('fixture-run','482913'),/human_auth_takeover_required/)
 assert.equal(io,0,'code-bearing work must reject before provider/database/sandbox I/O')
 globalThis.fetch=async input=>{
  const url=new URL(String(input));assert.equal(url.origin,'https://auth-fixture.supabase.co');assert.equal(url.searchParams.get('telegram_id'),'eq.123');assert.equal(url.searchParams.get('status'),'eq.paused')
  return new Response(JSON.stringify([{id:'owned-paused-run',metadata_json:{handoff:{}}}]),{headers:{'Content-Type':'application/json'}})
 }
 const reply=await notice.humanAuthTakeoverReply(123)
 assert.match(reply,/owned-paused-run\/browser/);assert.match(reply,/Take control/);assert.doesNotMatch(reply,/482913/)
}finally{globalThis.fetch=fetchBefore}
const noop=new Proxy({}, {get:()=>()=>null})
function load(path:string,deps:any,extra:any={}){const exports:any={};runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:(name:string)=>deps[name]||noop,process,console,URL,Request,Response,Buffer,AbortSignal,setTimeout,clearTimeout,...extra});return exports}
const json={json:(body:any,options:any={})=>new Response(JSON.stringify(body),{status:options.status||200})}
let work=0
process.env.CRON_SECRET='fixture-cron'
const internal=load('app/api/agent/approved-browser/route.ts',{'next/server':{NextResponse:json,after:()=>{work++}},'@/lib/agent/approved-browser-worker':new Proxy({}, {get:()=>()=>{work++;throw Error('code reached worker')}})})
for(const payload of [{loginCode:'482913'},{otp:'482913'},{bookingOtp:'482913'},{read:true,loginCode:'482913'},{comparison:true,otp:'482913'}]){
 const r=await internal.POST(new Request('https://fixture.invalid/api/agent/approved-browser',{method:'POST',headers:{authorization:'Bearer fixture-cron','content-type':'application/json'},body:JSON.stringify({runId:'fixture-run-id',...payload})}))
 assert.equal(r.status,400);assert.equal((await r.json()).error,'human_auth_takeover_required')
}
assert.equal(work,0)
const saved:any[]=[];let model=0
const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{telegram_id:123,whatsapp_id:'fixture-owner',name:'Fixture'}}),insert:(rows:any)=>{saved.push(rows);return{error:null}}}
const dash=load('app/api/dashboard/chat/route.ts',{'next/server':{NextResponse:json},'@/lib/dashboard/session':{getSession:async()=>({telegramId:'123'})},'@/lib/supabase-admin':{supabaseAdmin:{from:()=>q}},'@/lib/agent/actor':{resolveAgentActor:async()=>({legacyTelegramId:123})},'@/lib/agent/provider-booking':{otpReply},'@/lib/agent/browser-auth-notice':{shouldWithholdAuthenticationCode:async()=>true,humanAuthTakeoverReply:async()=> 'Take control on the same task; code not used.'},'@/lib/bot/process-message':{processIncomingMessage:()=>{model++;throw Error('code reached model')}},'@/lib/agent/browser-command':new Proxy({}, {get:()=>()=>{throw Error('code reached browser')}})})
for(const text of ['482913','code is 4829 13']){
 const req=new Request('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid','content-type':'application/json'},body:JSON.stringify({text})})
 const response=await dash.POST(Object.assign(req,{nextUrl:new URL(req.url)}));assert.equal(response.status,200);assert.equal((await response.json()).handledBy,'human-auth-required')
}
assert.equal(model,0);assert.doesNotMatch(JSON.stringify(saved),/482913|4829 13/);assert.match(JSON.stringify(saved),/authentication code withheld/)
console.log('T1c: actual chat/internal endpoints and executor reject code automation; owner-scoped same-run handoff; no code storage/model/provider I/O')
// ECC TDD follow-up: every conversational entrypoint must reject secondary codes before logging.
const centralLogs:any[]=[]
const central=load('lib/bot/process-message.ts',{'./resolve-user':{resolveUser:async()=>({telegramId:123,name:'Fixture'})},'@/lib/supabase-admin':{supabaseAdmin:{from:()=>q}},'@/lib/agent/browser-auth-notice':{shouldWithholdAuthenticationCode:async()=>true,humanAuthTakeoverReply:async()=> 'Complete authentication in Take control.'}}, {console:{...console,log:(...args:any[])=>{centralLogs.push(args);if(JSON.stringify(args).includes('482913'))throw Error('raw authentication code reached conversational logging')}}})
await assert.doesNotReject(async()=>{
 const result=await central.processIncomingMessage({channel:'telegram',externalUserId:'fixture-user',text:'482913'})
 assert.equal(result.handledBy,'human-auth-required')
},'central routing must reject authentication codes before any conversational log or model')
assert.doesNotMatch(JSON.stringify(centralLogs),/482913/)
console.log('Central entrypoint: authentication code withheld before conversational logs, persistence and model routing')
