// TEST-ONLY privacy diagnostic. Execute original 31 Oct job-hunting private data
// readers using fictional users. Mandatory safety RED is expected on unmodified code.
// DO NOT MERGE/DEPLOY. No real accounts, DB, Gmail, provider, model or applications.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path='lib/agent/jobs.ts'
const source=readFileSync(path,'utf8')
const caller=readFileSync('lib/agent/jobs-command.ts','utf8')
const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS)
const methods=['savedResumes','savedJobPrefs','saveJobPrefs'].map(name=>{
  const d=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)
  assert.ok(d?.body,'Original function missing: '+name)
  return d.getText(ast).replace(/^export\s+/,'')
})
const js=ts.transpileModule(methods.join('\n'),{
  fileName:path,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
}).outputText
const EVEN='9007199254740992', ODD='9007199254740993'
const EVEN_SECRET='Fictional private resume: Even Owner only.'
const docRows=new Map([
  ['42',[{id:'resume-42',telegram_id:'42',title:'42 CV',doc_type:'resume',summary:'42 fictional'}]],
  ['43',[{id:'resume-43',telegram_id:'43',title:'43 CV',doc_type:'resume',summary:'43 fictional'}]],
  [EVEN,[{id:'resume-even',telegram_id:EVEN,title:'Even CV',doc_type:'resume',summary:EVEN_SECRET}]],
  [ODD,[{id:'resume-odd',telegram_id:ODD,title:'Odd CV',doc_type:'resume',summary:'Fictional odd only'}]],
])
const prefsRows=new Map([
  ['42',[{content:'JOB_PREFS:Manager in Bengaluru'}]],
  ['43',[{content:'JOB_PREFS:Designer in Mumbai'}]],
  [EVEN,[{content:'JOB_PREFS:Private even preference'}]],
  [ODD,[{content:'JOB_PREFS:Private odd preference'}]],
])
function harness({returnedDocs,returnedPrefs}={}){
  const queries=[],inserts=[]
  const supabaseAdmin={from(table){
    assert.ok(['documents','memories'].includes(table),'Unexpected table: '+table)
    const filters=[]
    const q={
      select(columns){queries.push({table,op:'select',columns});return this},
      eq(column,value){assert.equal(column,'telegram_id');filters.push(value);queries.push({table,op:'eq',value});return this},
      like(column,value){assert.equal(column,'content');assert.equal(value,'JOB_PREFS:%');return this},
      order(){return this},limit(){return this},
      insert(row){assert.equal(table,'memories');inserts.push(row);return Promise.resolve({error:null})},
      then(resolve,reject){
        const owner=String(filters[0])
        const data=table==='documents'
          ?(returnedDocs!==undefined?returnedDocs:docRows.get(owner))
          :(returnedPrefs!==undefined?returnedPrefs:prefsRows.get(owner))
        return Promise.resolve({data:data||[],error:null}).then(resolve,reject)
      }
    }
    return q
  }}
  const clean=(v,max=500)=>String(v??'').replace(/\s+/g,' ').trim().slice(0,max)
  const functions=vm.runInNewContext(js+'\n({savedResumes,savedJobPrefs,saveJobPrefs})',{
    supabaseAdmin,clean,PREFS:'JOB_PREFS:',jobPrefsFrom:raw=>({raw}),
    String,Number,Promise,console:{log(){},error(){}}
  },{filename:path,timeout:2500})
  return {queries,inserts,resumes:functions.savedResumes,prefs:functions.savedJobPrefs,save:functions.saveJobPrefs}
}
let cp=0,cf=0,mp=0,mf=0
async function check(kind,label,fn){
  try{await fn();kind==='control'?cp++:mp++;console.log('PASS '+kind+': '+label)}
  catch(e){kind==='control'?cf++:mf++;console.error('FAIL '+kind+': '+label+' — '+String(e?.message||e).slice(0,300))}
}
// Controls prove the fixture is valid; no providers run.
await check('control','safe 42 reads only fictional 42 CV',async()=>{
  const h=harness(),rows=await h.resumes(42)
  assert.equal(rows.length,1);assert.equal(rows[0].id,'resume-42')
  assert.deepEqual(h.queries.filter(q=>q.op==='eq').map(q=>q.value),[42])
})
await check('control','safe 43 is separate',async()=>{
  const h=harness();assert.equal((await h.resumes(43))[0].id,'resume-43')
})
await check('control','missing fictional account yields no CV',async()=>{
  const h=harness();assert.equal((await h.resumes(404)).length,0)
})
await check('control','safe owner reads its own job preference',async()=>{
  const h=harness();assert.equal((await h.prefs(42)).raw,'Manager in Bengaluru')
})
await check('control','safe owner saves preference for 42 only',async()=>{
  const h=harness();await h.save(42,'Manager in Bengaluru')
  assert.equal(h.inserts.length,1);assert.equal(h.inserts[0].telegram_id,42)
})
await check('control','original source passes numeric actor to private CV and then model',async()=>{
  assert.match(caller,/const tg = params\.actor\.legacyTelegramId/)
  assert.match(caller,/savedResumes\(tg\)/)
  assert.match(caller,/resume\.summary/)
  assert.match(caller,/askClaude\(/)
  assert.match(source,/from\('documents'\)\.select\('id,title,doc_type,summary,created_at'\)/)
})
// Eight mandatory negatives. A safe source fix may reject all unsafe owner inputs.
await check('mandatory','rounded 64-bit owner must not query private CV',async()=>{
  const h=harness();await h.resumes(Number(ODD))
  assert.equal(h.queries.length,0,'unsafe actor queried documents')
})
await check('mandatory','odd owner cannot expose even owner CV for model evidence',async()=>{
  const h=harness(),rows=await h.resumes(Number(ODD))
  assert.ok(rows.every(x=>x.summary!==EVEN_SECRET),'wrong owner resume would reach model')
})
await check('mandatory','different 64-bit owners cannot select same private CV',async()=>{
  const h=harness(),a=await h.resumes(Number(EVEN)),b=await h.resumes(Number(ODD))
  if(a.length&&b.length)assert.notEqual(a[0].id,b[0].id,'owners collapsed')
})
await check('mandatory','private document owner query must never use unsafe Number',async()=>{
  const h=harness();await h.resumes(Number(ODD))
  assert.ok(h.queries.filter(q=>q.op==='eq').every(q=>typeof q.value==='string'||Number.isSafeInteger(q.value)),'rounded query')
})
await check('mandatory','returned private CV row must match exact owner',async()=>{
  const h=harness({returnedDocs:docRows.get('43')})
  assert.equal((await h.resumes(42)).length,0,'unbound foreign document row')
})
await check('mandatory','rounded owner must not read private job preferences',async()=>{
  const h=harness(),p=await h.prefs(Number(ODD))
  assert.equal(h.queries.length,0,'private preferences queried')
  assert.equal(p,null)
})
await check('mandatory','odd 64-bit owner must not read even owners preferences',async()=>{
  const h=harness(),p=await h.prefs(Number(ODD))
  assert.notEqual(p?.raw,'Private even preference','wrong owner preferences returned')
})
await check('mandatory','rounded owner must not write preferences to another owner',async()=>{
  const h=harness();await h.save(Number(ODD),'Odd owner only')
  assert.equal(h.inserts.length,0,'unsafe preference write persisted')
})
console.log('RESULT controls_pass='+cp+'/6 controls_fail='+cf+
  ' mandatory_pass='+mp+'/8 mandatory_fail='+mf)
if(cf)process.exit(2)
if(mf)process.exit(1)
