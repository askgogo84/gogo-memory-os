// TEST ONLY: execute the unchanged browser owner resolver with fictitious accounts.
// Sealed VM / synthetic database. No real browser, network, Vault or account operations.
// Expected result on unfixed main: controls GREEN, mandatory isolation assertions RED.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const file='lib/agent/secure-computer.ts'
const src=readFileSync(file,'utf8')
const ast=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const fn=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='canonicalBrowserOwnerId')
assert.ok(fn?.body,'original canonicalBrowserOwnerId function missing')
const js=ts.transpileModule(fn.getText(ast),{fileName:file,compilerOptions:{
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,
}}).outputText

const users=new Map([['12345','fixture-safe'],['9007199254740992','fixture-even'],
  ['9007199254740993','fixture-odd']])
function harness({dbError=false}={}){
  const queries=[]
  const db={from(table){
    assert.equal(table,'users')
    return {select(cols){
      assert.equal(cols,'id')
      return {eq(field,value){
        assert.equal(field,'telegram_id')
        queries.push({value})
        return {async maybeSingle(){
          if(dbError)return {data:null,error:{message:'fixture_db_error'}}
          const id=users.get(String(value))
          return {data:id?{id}:null,error:null}
        }}
      }}
    }}
  }}
  const resolve=vm.runInNewContext(js+'\ncanonicalBrowserOwnerId',
    {supabaseAdmin:db,Number,String,Error},{timeout:2000,filename:file})
  return {resolve,queries}
}
let controlPass=0,controlFail=0,safetyPass=0,safetyFail=0
async function check(kind,label,action){
  try{await action();if(kind==='control')controlPass++;else safetyPass++;
    console.log('PASS '+kind+': '+label)}
  catch(err){if(kind==='control')controlFail++;else safetyFail++;
    console.error('FAIL '+kind+': '+label+' ('+String(err?.message||err).slice(0,160)+')')}
}
await check('control','UUID owner passes without a legacy-ID lookup',async()=>{
  const h=harness()
  assert.equal(await h.resolve('fixture-uuid-1234'),'fixture-uuid-1234')
  assert.equal(h.queries.length,0)
})
await check('control','safe numeric legacy owner resolves to stored UUID',async()=>{
  const h=harness()
  assert.equal(await h.resolve('12345'),'fixture-safe')
  assert.deepEqual(h.queries.map(x=>String(x.value)),['12345'])
})
await check('control','query error fails closed',async()=>{
  const h=harness({dbError:true})
  await assert.rejects(h.resolve('12345'),/browser_owner_lookup_failed/)
})
await check('control','resolved owner names persistent browser sandbox',()=>{
  assert.match(src,/async function getComputer\(userId:string[\s\S]{0,250}canonicalBrowserOwnerId\(userId\)/)
  assert.match(src,/const name=userSandboxName\(canonicalUserId\)/)
  assert.match(src,/Sandbox\.getOrCreate\(\{[\s\S]{0,300}persistent:true/)
})

const a='9007199254740992',b='9007199254740993'
await check('mandatory','distinct 64-bit owner strings must never select the same sandbox owner',async()=>{
  const h=harness()
  let x=null,y=null
  try{x=await h.resolve(a)}catch{}
  try{y=await h.resolve(b)}catch{}
  if(x!==null&&y!==null)assert.notEqual(x,y,'both owners resolved to one UUID')
})
await check('mandatory','the odd 64-bit owner must resolve exactly or be refused',async()=>{
  const h=harness()
  let resolved=null,rejected=false
  try{resolved=await h.resolve(b)}catch{rejected=true}
  assert.ok(rejected||resolved==='fixture-odd','odd owner resolved to '+resolved)
})
await check('mandatory','service-role queries must not receive unsafe JS numbers',async()=>{
  const h=harness()
  try{await h.resolve(b)}catch{}
  assert.ok(h.queries.every(x=>typeof x.value!=='number'||Number.isSafeInteger(x.value)),
    'rounded number entered privileged users.telegram_id lookup')
})
await check('mandatory','already-rounded numeric input must be rejected before lookup',async()=>{
  const h=harness()
  await assert.rejects(h.resolve(Number(b)),/owner|identity|invalid|unsafe|precision|range/i)
  assert.equal(h.queries.length,0)
})
console.log('RESULT controls_pass='+controlPass+'/4 controls_fail='+controlFail+
  ' mandatory_pass='+safetyPass+'/4 mandatory_fail='+safetyFail)
if(controlFail)process.exit(2)
if(safetyFail)process.exit(1)
