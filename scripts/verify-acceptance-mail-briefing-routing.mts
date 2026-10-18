import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL='https://mail-briefing.invalid'
process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-only'
process.env.OPENAI_API_KEY='fixture-only'
process.env.ANTHROPIC_API_KEY='fixture-only'
const {detectIntent}=await import('../lib/bot/detect-intent')
const gmail=await import('../lib/bot/handlers/gmail-read')
const failures:string[]=[]
async function check(label:string,fn:()=>unknown){try{await fn();console.log('PASS '+label)}catch(e:any){failures.push(label+': '+e.message)}}
const mail='What needs my attention from my email? Identify actionable messages and link each item to its source email. Do not reply, send, archive, delete or mark anything as read.'
const briefing='Give me a morning briefing using current calendar events, reminders and open loops. Clearly distinguish upcoming events from past events and state missing information. Do not describe old flights as arriving soon. Do not create, send or change anything else.'
await check('exact first20 Gmail attention request takes deterministic private read',()=>assert.equal(detectIntent(mail).type,'read_gmail'))
await check('own mailbox scope is not a sender filter',()=>{
 for(const text of [mail,'What needs my attention from my emails?','Show anything urgent from my inbox.'])assert.deepEqual(gmail.parseGmailReadFilter(text),{sender:null,topic:null})
 assert.deepEqual(gmail.parseGmailReadFilter('Read my latest email from Swiggy'),{sender:'Swiggy',topic:null})
})
await check('exact detailed morning briefing reaches the actual briefing route',()=>assert.equal(detectIntent(briefing).type,'morning_briefing'))
await check('settings, send and unrelated briefing mentions retain separate authority',()=>{
 assert.equal(detectIntent('Set my morning briefing at 8 am').type,'set_briefing_time')
 assert.notEqual(detectIntent('Email Rahul my morning briefing').type,'morning_briefing')
 assert.notEqual(detectIntent('What should I include in a morning briefing template?').type,'morning_briefing')
})
const noop=new Proxy({}, {get:(_target,key)=>/^(?:record|observe|capture)/.test(String(key))?async()=>null:()=>null})
let mailCalls=0,briefingCalls=0
const db={from:(table:string)=>{assert.equal(table,'conversations');return{insert:async(row:any)=>{assert.equal(row.telegram_id,123);return{error:null}}}}}
const deps:any={
 './resolve-user':{resolveUser:async()=>({id:'fixture',telegramId:123,whatsappId:'fixture-owner',name:'Example'})},
 './detect-intent':{detectIntent},'@/lib/agent/semantic-gate':{gateDetectedIntent:(intent:any)=>intent},
 './format-response':{formatOutgoingText:(_channel:string,text:string)=>text},
 '@/lib/supabase-admin':{supabaseAdmin:db},'@/lib/limits':{checkAndIncrementLimit:async()=>({allowed:true})},
 './handlers/gmail-read':{...gmail,buildGmailReadReply:async(tg:number,_mode:string,_limit:number,filter:any)=>{assert.equal(tg,123);assert.deepEqual(filter,{sender:null,topic:null});mailCalls++;return 'verified-fixture-inbox-read'}},
 './handlers/morning-briefing':{buildMorningBriefing:async(tg:number)=>{assert.equal(tg,123);briefingCalls++;return 'verified-fixture-briefing'}},
 './handlers/response-style':{styleReplyByIntent:(_intent:string,text:string)=>text},
 '@/lib/claude':{askClaude:()=>{throw Error('private read fell through to general model')},askClaudeWithContext:()=>{throw Error('private read fell through to web model')},isContextSynthesisTurn:()=>false},
}
const pm:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/bot/process-message.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:pm,require:(name:string)=>deps[name]||noop,process,console,URL,Request,Response,Buffer})
await check('actual shared entry calls owner-bound Gmail reader, never general/web model',async()=>{
 assert.equal((await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text:mail,messageType:'text'})).text,'verified-fixture-inbox-read');assert.equal(mailCalls,1)
})
await check('actual shared entry calls owner-bound briefing builder, never web search',async()=>{
 assert.equal((await pm.processIncomingMessage({channel:'whatsapp',externalUserId:'fixture-owner',text:briefing,messageType:'text'})).text,'verified-fixture-briefing');assert.equal(briefingCalls,1)
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}
