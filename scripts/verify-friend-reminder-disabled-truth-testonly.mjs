// TEST ONLY: run original createFriendReminder against an in-memory provider-free DB.
// Do not register this diagnostic in ordinary npm test or merge the expected safety-RED draft.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const ts=require('typescript')

const source=fs.readFileSync('lib/bot/handlers/friend-reminders.ts','utf8')
const cron=fs.readFileSync('app/api/cron/reminders/route.ts','utf8')
const caller=fs.readFileSync('lib/bot/process-message.ts','utf8')
const parsed=ts.createSourceFile('friend-reminders.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const original=parsed.statements.find(x=>ts.isFunctionDeclaration(x) && x.name?.text==='createFriendReminder')
assert.ok(original,'must execute unchanged original createFriendReminder, not a copied implementation')
const js=ts.transpileModule(
  original.getText(parsed).replace(/^\s*export\s+/,'')+'\n globalThis.__originalFriendReminder=createFriendReminder;',
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}
).outputText

// These original cron/caller preconditions establish the false-success boundary.
assert.match(cron,/const F2F_REMINDERS_ENABLED\s*=\s*process\.env\.F2F_REMINDERS_ENABLED\s*===\s*'1'/)
assert.match(cron,/\(!F2F_REMINDERS_ENABLED\s*&&\s*!owner\)/)
assert.match(cron,/await finish\('suppressed'\)/)
assert.ok(caller.includes("Done — I'll remind"),'caller currently returns a successful scheduled receipt')

const future='2099-01-02T12:00:00.000Z'
const params={ownerTelegramId:101,senderName:'Test Owner',recipientWhatsapp:'+919888880002',rest:'pay rent tomorrow at 5 pm',whenIso:future,task:'pay rent'}
function setup(flag,{failInsert=false}={}){
  const reads=[],inserted=[]
  const users={
    select(column){
      assert.equal(column,'timezone')
      return {eq(column,value){
        reads.push({table:'users',column,value})
        return {maybeSingle:async()=>({data:{timezone:'Asia/Kolkata'}})}
      }}
    }
  }
  const reminders={
    insert:async row=>{
      inserted.push({...row})
      return {error:failInsert?{message:'synthetic failure'}:null}
    }
  }
  const supabaseAdmin={
    from(table){
      if(table==='users')return users
      if(table==='reminders')return reminders
      throw new Error('Unexpected DB table: '+table)
    }
  }
  const env={}
  if(flag!==undefined)env.F2F_REMINDERS_ENABLED=flag
  const sandbox={supabaseAdmin,Date,Error,console,process:{env},parseFriendTime:()=>null,friendTimeLabel:()=> '2 Jan 2099 IST'}
  sandbox.globalThis=sandbox
  vm.createContext(sandbox)
  vm.runInContext(js,sandbox,{timeout:2000,filename:'original-createFriendReminder.transpiled.js'})
  assert.equal(typeof sandbox.__originalFriendReminder,'function')
  return {create:sandbox.__originalFriendReminder,inserted,reads}
}
let good=0,bad=0
async function check(kind,label,fn){
  try{await fn();good++;console.log('PASS '+kind+': '+label)}
  catch(err){bad++;console.error('FAIL '+kind+': '+label+' — '+String(err?.message||err))}
}
await check('CONTROL','enabled delegated reminder inserts exact owner/recipient with no provider side effect',async()=>{
  const h=setup('1')
  const res=await h.create(params)
  assert.equal(res.whenHuman,'2 Jan 2099 IST')
  assert.equal(h.inserted.length,1)
  assert.equal(h.inserted[0].telegram_id,101)
  assert.equal(h.inserted[0].whatsapp_to,'+919888880002')
  assert.equal(h.inserted[0].sent,false)
  assert.deepEqual(h.reads,[{table:'users',column:'telegram_id',value:101}])
})
await check('CONTROL','expired delegated reminder creates no row',async()=>{
  const h=setup('1')
  await assert.rejects(()=>h.create({...params,whenIso:'2001-01-02T12:00:00.000Z'}),/friend_reminder_time_unresolved/)
  assert.equal(h.inserted.length,0)
})
await check('CONTROL','database insert error never produces a success receipt',async()=>{
  const h=setup('1',{failInsert:true})
  await assert.rejects(()=>h.create(params),/friend_reminder_insert_failed/)
})
await check('CONTROL','different safe owners preserve distinct persisted owner IDs',async()=>{
  const h=setup('true')
  await h.create({...params,ownerTelegramId:101})
  await h.create({...params,ownerTelegramId:202,recipientWhatsapp:'+919888880003'})
  assert.deepEqual(h.inserted.map(x=>x.telegram_id),[101,202])
  assert.deepEqual(h.inserted.map(x=>x.whatsapp_to),['+919888880002','+919888880003'])
})
for(const [label,flag] of [
  ['flag unset (production default)',undefined],
  ['flag explicitly false','false'],
  ['flag explicitly zero','0'],
  ['flag empty string','']
]){
  await check('SAFETY','disabled friend delivery must reject scheduling WITHOUT inserting: '+label,async()=>{
    const h=setup(flag)
    let succeeded=false
    try{await h.create(params);succeeded=true}catch{}
    assert.equal(succeeded,false,'no successful scheduling receipt while recipient delivery is disabled')
    assert.equal(h.inserted.length,0,'no silently undeliverable row created while disabled')
  })
}
console.log('RESULT: '+good+' PASS; '+bad+' FAIL (4 positive controls, 4 mandatory disabled-delivery assertions)')
if(bad)process.exitCode=1
