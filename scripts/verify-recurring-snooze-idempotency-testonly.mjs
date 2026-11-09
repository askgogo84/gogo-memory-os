// TEST ONLY. Execute original reminder snooze functions with fictional in-memory data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const file='lib/feature-intents.ts'
const src=readFileSync(file,'utf8')
const ast=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const names=['parseSnoozeDuration','tryHandleSnoozeCommand']
const originals=names.map(name=>{
  const node=ast.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text===name)
  assert.ok(node?.body,'original source function absent: '+name)
  return node.getText(ast)
})
assert.match(src,/tryHandleSnoozeCommand\(extra\.telegramId,phone,text\)/,'snooze handler has no router callsite')
const js=ts.transpileModule(originals.join('\n\n'),{fileName:file,compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
}}).outputText

function fixture({recurring=true,noRecent=false,insertFailure=false,unknownFirst=false}={}){
  const original={id:'fixture-fired-42',telegram_id:42,chat_id:42,message:'Synthetic recurring task',
    is_recurring:recurring,recurring_pattern:recurring?'daily':null,whatsapp_to:'whatsapp:+15550000042',
    timezone:'Asia/Kolkata',sent_at:new Date(Date.now()-600000).toISOString(),sent:false}
  const inserted=[],updated=[],reads=[]
  let attempts=0
  const db={from(table){
    assert.equal(table,'reminders','fixture forbids other tables')
    return {
      select(fields){
        assert.match(fields,/id,message,is_recurring,recurring_pattern,whatsapp_to,timezone,chat_id,telegram_id,sent_at/)
        const clauses=[]
        const q={
          eq(key,value){clauses.push({key,value});return q},
          gte(key,value){clauses.push({key,value});return q},
          order(key,opt){assert.equal(key,'sent_at');assert.equal(opt?.ascending,false);return q},
          limit(n){
            assert.equal(n,1)
            reads.push(clauses)
            assert.ok(clauses.some(x=>x.key==='telegram_id'&&x.value===42),'owner scope missing')
            assert.ok(clauses.some(x=>x.key==='sent_at'),'fired time predicate missing')
            return Promise.resolve({data:noRecent?[]:[original],error:null})
          },
        }
        return q
      },
      insert(payload){
        attempts++
        assert.equal(payload.telegram_id,42)
        assert.equal(payload.chat_id,42)
        assert.equal(payload.is_recurring,false)
        assert.equal(payload.sent,false)
        if(!insertFailure)inserted.push({...payload})
        const fail=insertFailure||(unknownFirst&&attempts===1)
        return Promise.resolve({error:fail?{message:'fictional_commit_unknown'}:null})
      },
      update(patch){return {eq(key,value){
        assert.equal(key,'id');assert.equal(value,original.id)
        updated.push({...patch})
        return Promise.resolve({error:null})
      }}},
    }
  }}
  const api=vm.runInNewContext(js+'\n({parseSnoozeDuration,tryHandleSnoozeCommand})',
    {supabaseAdmin:db,Date,Number,String,Promise,Math,console},
    {filename:file,timeout:2000})
  return {...api,original,inserted,updated,reads,get attempts(){return attempts}}
}
let good=0,bad=0,pass=0,fail=0
async function check(kind,label,test){
  try{await test();kind==='control'?good++:pass++;console.log('PASS '+kind+': '+label)}
  catch(e){kind==='control'?bad++:fail++;console.error('FAIL '+kind+': '+label+' — '+String(e?.message||e).slice(0,230))}
}
const run=(f)=>f.tryHandleSnoozeCommand(42,'whatsapp:+15550000042','snooze 10m')
await check('control','parser recognizes duration, rejects unrelated text',async()=>{
  const f=fixture()
  assert.equal(f.parseSnoozeDuration('snooze 10 mins')?.ms,600000)
  assert.equal(f.parseSnoozeDuration('Snooze 2h')?.ms,7200000)
  assert.equal(f.parseSnoozeDuration('tell me about my emails'),null)
})
await check('control','no recently fired reminder means no write',async()=>{
  const f=fixture({noRecent:true})
  assert.equal(await run(f),null);assert.equal(f.inserted.length,0)
})
await check('control','one recurring snooze creates one-off, original unchanged',async()=>{
  const f=fixture()
  assert.match(await run(f),/Snoozed!/)
  assert.equal(f.inserted.length,1);assert.equal(f.updated.length,0)
  assert.equal(f.original.sent,false)
})
await check('control','one-off snooze updates original, inserts none',async()=>{
  const f=fixture({recurring:false})
  assert.match(await run(f),/Snoozed!/)
  assert.equal(f.updated.length,1);assert.equal(f.updated[0].sent,false)
  assert.equal(f.inserted.length,0)
})
await check('control','definite insert error returns failure rather than success',async()=>{
  const f=fixture({insertFailure:true})
  assert.match(await run(f),/couldn't snooze/)
  assert.equal(f.inserted.length,0)
})
await check('mandatory','sequential replay of same recurring snooze creates one reminder',async()=>{
  const f=fixture();await run(f);await run(f)
  assert.equal(f.inserted.length,1,'replay duplicated one-off reminder')
})
await check('mandatory','concurrent identical recurring snoozes atomically claim once',async()=>{
  const f=fixture();await Promise.all([run(f),run(f)])
  assert.equal(f.inserted.length,1,'parallel replay duplicated reminder')
})
await check('mandatory','unknown insert outcome does not allow blind duplicate retry',async()=>{
  const f=fixture({unknownFirst:true})
  assert.match(await run(f),/couldn't snooze/)
  await run(f)
  assert.equal(f.inserted.length,1,'ambiguous committed first insert followed by second insert')
})
console.log('RESULT controls_pass='+good+'/5 controls_fail='+bad+
  ' mandatory_pass='+pass+'/3 mandatory_fail='+fail)
if(bad)process.exit(2)
if(fail)process.exit(1)
