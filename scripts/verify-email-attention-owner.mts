// Inert actual-source regression for Email Attention legacy-owner precision.
// No customer records, provider/network calls, credentials, browser or actual DB.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path='lib/email/attention-store.ts'
const source=fs.readFileSync(path,'utf8')
const parsed=ts.createSourceFile(path,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS)
const wanted=new Set(['exactAttentionOwner','loadRules','saveRule','readAttentionSources','buildAttentionCard','handleEmailAttentionCommand'])
const declarations=parsed.statements.filter((n):n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n)&&!!n.name&&wanted.has(n.name.text))
for(const name of ['loadRules','saveRule','readAttentionSources','buildAttentionCard','handleEmailAttentionCommand'])
  assert.ok(declarations.some(d=>d.name?.text===name), 'actual implementation missing: '+name)
const code=ts.transpileModule(declarations.map(n=>n.getText(parsed)).join('\n\n'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText

let lookups=0,records=0,providerReads=0
const db={from(table:string){
  lookups++
  const q:any={
    select(){return q},eq(){return q},is(){return q},order(){return q},gte(){return q},
    limit(){return Promise.resolve({data:[],error:null})},
    maybeSingle:async()=>({data:null,error:null}),
    insert(){records++;return q},update(){records++;return q},
    then(resolve:any,reject:any){return Promise.resolve({data:null,error:null}).then(resolve,reject)},
  }
  return q
}}
const loadedExports:any={}
const context:any={
  exports:loadedExports,module:{exports:loadedExports},supabaseAdmin:db,Number,BigInt,Object,String,Date,Set,Promise,console,
  readGmail:async()=>{providerReads++;return null},
  readForwarded:async()=>{providerReads++;return null},
  readComposio:async()=>{providerReads++;return null},
  parseAttentionCommand:(text:string)=>text==='what do you flag'?{type:'rules'}:null,
  isUndo:()=>false,
  ok:(text:string)=>({text,status:'completed'}),
}
vm.runInNewContext(code,context,{filename:'email-attention-owner-actual-source.js'})
const mod:any=context.exports
const badOwners=[9007199254740992, '9007199254740993', 0, -0, 12.25, Number.NaN, Number.POSITIVE_INFINITY, '00101', '1e2']
async function main(){
for(const owner of badOwners){
  const before={lookups,records,providerReads}
  await assert.rejects(
    ()=>mod.buildAttentionCard({legacyTelegramId:owner,timezone:'Asia/Kolkata'},{polish:null}),
    /email_attention_owner_invalid/,
    'invalid or colliding owner must not consult private email; '+String(owner),
  )
  assert.deepEqual({lookups,records,providerReads},before,'private email boundary must not run for invalid owner')
  await assert.rejects(()=>mod.handleEmailAttentionCommand({
    actor:{legacyTelegramId:owner,timezone:'Asia/Kolkata'},text:'what do you flag',
  }),/email_attention_owner_invalid/)
  assert.deepEqual({lookups,records,providerReads},before,'private rules/commands must fail before DB/provider')
}
for(const id of [9007199254740992, Number.NaN, 0]){
  const before=lookups
  await assert.rejects(()=>mod.loadRules(id),/email_attention_owner_invalid/)
  await assert.rejects(()=>mod.saveRule(id,{kind:'always',source:'chat',matchType:'sender',matchValue:'a@example.test',label:'fixture'}),/email_attention_owner_invalid/)
  await assert.rejects(()=>mod.readAttentionSources(id),/email_attention_owner_invalid/)
  assert.equal(lookups,before,'direct exported readers/writers cannot start any private query')
}
for(const good of [101,-101,'101']){
  const before=lookups
  const card=await mod.buildAttentionCard({legacyTelegramId:good,timezone:'Asia/Kolkata'},{polish:null})
  assert.equal(card.connected,false,'safe owner without linked mailbox stays disconnected')
  const rules=await mod.handleEmailAttentionCommand({actor:{legacyTelegramId:good,timezone:'Asia/Kolkata'},text:'what do you flag'})
  assert.match(rules.text,/What I flag for you/)
  assert.ok(lookups>before,'legitimate exact owner reaches normal owner-bound private-query path')
}
assert.equal(records,0,'no state mutations are needed in this fixture')
console.log('Email Attention exact-owner: actual handlers/readers deny ambiguous signed64/invalid owners before private query; safe legacy owners retained (inert)')
}
main().catch(error=>{console.error(error);process.exitCode=1})
