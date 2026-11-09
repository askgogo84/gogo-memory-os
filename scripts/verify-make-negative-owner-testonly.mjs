// Test-only Make signed-owner compatibility diagnostic against UNCHANGED production functions.
// All users, documents, model output, queries and saves are fictional/in-memory.
// No real Supabase, model, provider, credential, WhatsApp, network or account operations.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path='lib/make/store.ts'
const source=fs.readFileSync(path,'utf8')
const tree=ts.createSourceFile(path,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS)
const names=['exactLegacyOwner','ownerTelegramId','handleMakeDoc']
const original=names.map(name=>{
  const decl=tree.statements.find(s=>ts.isFunctionDeclaration(s)&&s.name?.text===name)
  assert.ok(decl,'missing unchanged Make production function: '+name)
  return decl.getText(tree).replace(/^\s*export\s+/,'')
}).join('\n\n')
const compiled=ts.transpileModule(original,{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}
}).outputText
const BIG='9007199254740993'
const REAL_NEGATIVE='-2251799813685248' // representative of the signed safe mobile-owner allocation range

function fixture({owner='42',legacy=owner,uuid='fictional-uuid',mode='create',error=null}={}){
  const ownerQueries=[],saved=[],generated=[],historyReads=[],docReads=[],edits=[]
  const supabaseAdmin={
    from(table){
      assert.equal(table,'users','no real/non-user database access expected')
      const query={
        select(fields){assert.equal(fields,'telegram_id');return query},
        eq(field,value){assert.equal(field,'id');ownerQueries.push(value);return query},
        maybeSingle:async()=>({data:owner===null?null:{telegram_id:owner},error}),
      }
      return query
    },
  }
  const doc={format:'deck',title:'Fictional deck',slides:[]}
  const injected={
    supabaseAdmin,
    makeDocRequest:()=>mode==='create'?{format:'deck',request:'fixture'}:null,
    isMakeEdit:()=>mode==='edit',
    generateDoc:async()=>{generated.push('fixture');return {doc,sources:[]}},
    saveDoc:async(id,input)=>{saved.push({owner:id,format:input.format});return 'fictional-doc-id'},
    chatReply:()=> 'Fictional deck created',
    lastAssistantReply:async id=>{historyReads.push(id);return 'fictional-reply'},
    madeIdFromReply:()=> 'fictional-doc-id',
    loadDoc:async id=>{
      docReads.push(id)
      return String(id)===String(owner)?{doc,content:{},owner:id}:null
    },
    editDoc:async()=>{edits.push('fixture');return doc},
    updateDoc:async(id)=>{saved.push({owner:id,format:'edit'})},
    editedReply:()=> 'Fictional deck edited',
    console,
  }
  const functions=vm.runInNewContext(compiled+'\n({exactLegacyOwner,ownerTelegramId,handleMakeDoc})',injected,{timeout:1000})
  return {
    ownerQueries,saved,generated,historyReads,docReads,edits,
    run:()=>functions.handleMakeDoc({actor:{userId:uuid,legacyTelegramId:legacy},text:mode==='create'?'Make a deck about an invented event':'Make slide 2 shorter'}),
  }
}

let controls=0,controlFailures=0,mandatoryPass=0,mandatoryFail=0
async function check(label,required,fn){
  try{
    await fn()
    if(required)mandatoryPass++;else controls++
    console.log('PASS ['+(required?'MANDATORY':'CONTROL')+'] '+label)
  }catch(e){
    if(required)mandatoryFail++;else controlFailures++
    console.error('FAIL ['+(required?'MANDATORY':'CONTROL')+'] '+label+': '+(e?.message||e))
  }
}
function assertSaved(h,owner,kind='deck'){
  assert.equal(h.saved.length,1,'expected exactly one fictional save')
  assert.equal(h.saved[0].owner,owner,'saved owner differs from persisted UUID-bound owner')
  assert.equal(h.saved[0].format,kind)
}

await check('positive UUID-bound owner creates deck using exact persisted identifier',false,async()=>{
  const h=fixture()
  assert.equal((await h.run())?.status,'completed')
  assertSaved(h,'42')
  assert.deepEqual(h.ownerQueries,['fictional-uuid'])
})
await check('positive 64-bit TEXT owner remains exact without Number rounding',false,async()=>{
  const h=fixture({owner:BIG,legacy:42})
  assert.equal((await h.run())?.status,'completed')
  assertSaved(h,BIG)
})
await check('positive UUID-bound owner can edit owned deck',false,async()=>{
  const h=fixture({mode:'edit'})
  assert.equal((await h.run())?.status,'completed')
  assertSaved(h,'42','edit')
})
await check('missing UUID owner is not replaced by unrelated legacy identity',false,async()=>{
  const h=fixture({owner:null,legacy:77})
  const result=await h.run()
  assert.equal(result?.status,'failed')
  assert.equal(h.saved.length,0)
  assert.equal(h.generated.length,0)
})
await check('unsafe numeric stored owner is denied before document generation',false,async()=>{
  const h=fixture({owner:9007199254740992,legacy:42})
  assert.equal((await h.run())?.status,'failed')
  assert.equal(h.saved.length,0)
  assert.equal(h.generated.length,0)
})
await check('fractional/exponential persisted owner is not silently coerced',false,async()=>{
  for(const owner of ['42.5','4.2e1','0']){
    const h=fixture({owner,legacy:42})
    assert.equal((await h.run())?.status,'failed')
    assert.equal(h.saved.length,0)
  }
})
await check('unreadable UUID owner lookup fails closed without model call',false,async()=>{
  const h=fixture({owner:'42',error:{message:'fictional-query-denied'}})
  assert.equal((await h.run())?.status,'failed')
  assert.equal(h.saved.length,0)
  assert.equal(h.generated.length,0)
})

// Mandatory compatibility: allocateWhatsAppOwnerId intentionally generates negative,
// nonzero, safe-integer mobile account identifiers. They must remain valid when
// verified via the persisted UUID, without reviving suffix/rounded owner fallback.
await check('valid negative TEXT WhatsApp owner creates its own Make deck',true,async()=>{
  const h=fixture({owner:'-42',legacy:-42})
  assert.equal((await h.run())?.status,'completed','UUID-bound valid negative owner was rejected')
  assertSaved(h,'-42')
})
await check('valid negative safe NUMBER from users row is canonicalized exactly',true,async()=>{
  const h=fixture({owner:-42,legacy:-42})
  assert.equal((await h.run())?.status,'completed')
  assertSaved(h,'-42')
})
await check('allocator-range negative WhatsApp owner creates its own deck',true,async()=>{
  const h=fixture({owner:REAL_NEGATIVE,legacy:Number(REAL_NEGATIVE)})
  assert.equal((await h.run())?.status,'completed')
  assertSaved(h,REAL_NEGATIVE)
})
await check('UUID-bound negative stored owner outranks stale positive legacy actor',true,async()=>{
  const h=fixture({owner:'-42',legacy:777})
  assert.equal((await h.run())?.status,'completed')
  assertSaved(h,'-42')
  assert.ok(!h.saved.some(row=>row.owner==='777'||row.owner===777),'unverified legacy owner used')
})
await check('verified negative WhatsApp owner can edit its own existing deck',true,async()=>{
  const h=fixture({owner:'-42',legacy:-42,mode:'edit'})
  assert.equal((await h.run())?.status,'completed')
  assertSaved(h,'-42','edit')
  assert.ok(h.docReads.every(owner=>owner==='-42'),'unverified cross-tenant document read')
})

console.log('MAKE SIGNED WHATSAPP OWNER: controls '+controls+' PASS / '+controlFailures+
  ' FAIL; mandatory '+mandatoryPass+' PASS / '+mandatoryFail+' FAIL')
if(controlFailures)process.exitCode=2
else if(mandatoryFail)process.exitCode=1
