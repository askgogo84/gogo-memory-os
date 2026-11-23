// Test-only diagnostic: the deployed syncMeetingActionMemories function with fictional stored memories.
// No network, real database, providers, credentials, account mutations, or real sends.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = 'lib/agent/open-loops.ts'
const source = fs.readFileSync(path, 'utf8')
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const original = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'syncMeetingActionMemories')
assert.ok(original, 'unchanged production syncMeetingActionMemories function is required')
const compiled = ts.transpileModule(original.getText(ast), {
  compilerOptions: {module:ts.ModuleKind.None, target:ts.ScriptTarget.ES2022},
}).outputText

const A = '9007199254740992'
const B = '9007199254740993'
const at = '2026-10-30T09:00:00.000Z'
function meetingRow(owner, suffix = owner) {
  return {
    id:'fictional-memory-' + suffix,
    telegram_id:owner, created_at:at,
    content:JSON.stringify({type:'followup_state',kind:'meeting_action_items',
      payload:{items:[{message:'SYNTHETIC_PRIVATE meeting commitment owned by ' + owner,
        remindAtIso:'2026-11-04T10:00:00.000Z'}]}}),
  }
}
function harness(opts={}) {
  const memories = new Map(opts.memories ?? [['42',[meetingRow('42')]]])
  const consent = new Map(opts.consent ?? [['42',{telegram_id:'42',memory_enabled:true}]])
  const reads=[],writes=[]
  const db = {
    from(table) {
      assert.ok(['memories','user_consent_settings'].includes(table), 'unexpected DB table: ' + table)
      const filters={}
      const query={
        select(fields) { filters.selectedFields=fields; return query },
        eq(key,value) { filters[key]=value; return query },
        gte() { return query },
        order() { return query },
        limit() {
          assert.equal(table,'memories','unexpected list query')
          reads.push({table,owner:String(filters.telegram_id),raw:filters.telegram_id,fields:filters.selectedFields})
          return Promise.resolve({data:memories.get(String(filters.telegram_id))??[],error:opts.memoryError??null})
        },
        maybeSingle() {
          assert.equal(table,'user_consent_settings','unexpected single-row query')
          reads.push({table,owner:String(filters.telegram_id),raw:filters.telegram_id,fields:filters.selectedFields})
          return Promise.resolve({data:consent.get(String(filters.telegram_id))??null,error:opts.consentError??null})
        },
      }
      return query
    },
  }
  const context = {
    supabaseAdmin:db,
    clean:(value,max=220)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max),
    upsertOpenLoop:async input=>{writes.push(input);return {id:'fictional-loop'}},
    isoPlusHoursFrom:(iso,h)=>new Date(Date.parse(iso)+h*3600_000).toISOString(),
    Date, console,
  }
  const run=vm.runInNewContext(compiled+'\nsyncMeetingActionMemories',context,{timeout:1000})
  assert.equal(typeof run,'function')
  return {reads,writes,run}
}
async function nonThrowingRun(h,owner) {
  try { return {value:await h.run(owner),error:null} } catch(error) { return {value:null,error} }
}
let controlPass=0,controlFail=0,mandatoryPass=0,mandatoryFail=0
async function check(name,mandatory,fn) {
  try {
    await fn()
    if(mandatory) mandatoryPass++
    else controlPass++
    console.log('PASS ['+(mandatory?'MANDATORY':'CONTROL')+'] '+name)
  } catch(err) {
    if(mandatory) mandatoryFail++
    else controlFail++
    console.error('FAIL ['+(mandatory?'MANDATORY':'CONTROL')+'] '+name+': '+(err?.message||err))
  }
}
await check('safe canonical owner reads and retains its own fictional meeting action',false,async()=>{
  const h=harness()
  assert.equal(await h.run('42'),1)
  assert.equal(h.writes.length,1)
  assert.equal(h.writes[0].telegramId,'42')
  assert.equal(h.writes[0].sourceId,'fictional-memory-42:0')
  assert.equal(h.reads.at(-1).owner,'42')
})
await check('valid negative safe WhatsApp owner still retains its own meeting action',false,async()=>{
  const h=harness({memories:[['-42',[meetingRow('-42')]]],consent:[['-42',{telegram_id:'-42',memory_enabled:true}]]})
  assert.equal(await h.run('-42'),1)
  assert.equal(h.writes[0].telegramId,'-42')
})
await check('no matching stored memory creates no meeting action',false,async()=>{
  const h=harness({memories:[]})
  assert.equal(await h.run('42'),0)
  assert.equal(h.writes.length,0)
})
await check('non-meeting stored memory cannot become an action',false,async()=>{
  const row={...meetingRow('42'),content:JSON.stringify({type:'note',payload:{items:[{message:'PRIVATE'}]}})}
  const h=harness({memories:[['42',[row]]]})
  assert.equal(await h.run('42'),0)
  assert.equal(h.writes.length,0)
})
await check('malformed synthetic memory JSON is ignored',false,async()=>{
  const h=harness({memories:[['42',[{...meetingRow('42'),content:'{not valid json'}]]]})
  assert.equal(await h.run('42'),0)
  assert.equal(h.writes.length,0)
})
await check('failed private memory read does not create an action',false,async()=>{
  const h=harness({memoryError:{message:'synthetic-db-down'}})
  await assert.rejects(h.run('42'),/open_loop_meeting_memory_read_failed/)
  assert.equal(h.writes.length,0)
})

// Required privacy/consent gates: currently RED on unchanged deployed source.
// A future fix must be retested at the actual corrected literal feature head.
await check('adjacent int64 owner B cannot read owner A private meeting action',true,async()=>{
  const h=harness({memories:[[A,[meetingRow(A,'A')]]]})
  await nonThrowingRun(h,B)
  assert.ok(!h.reads.some(x=>x.table==='memories'&&x.owner===A),
    'BIGINT owner B was rounded to A before private memory lookup')
  assert.equal(h.writes.length,0,'owner A private meeting action was attributed to B')
})
await check('already-rounded unsafe numeric account must fail before private reads',true,async()=>{
  const h=harness()
  await nonThrowingRun(h,9007199254740992)
  assert.equal(h.reads.filter(x=>x.table==='memories').length,0,'unsafe numeric owner entered memory query')
  assert.equal(h.writes.length,0)
})
await check('persisted memory row with mismatched exact owner must not become target open loop',true,async()=>{
  const h=harness({memories:[['42',[meetingRow('99','other-owner')]]]})
  await nonThrowingRun(h,'42')
  assert.equal(h.writes.length,0,'row owned by 99 was synthesized as owner 42')
})
await check('exponent-form account must not coerce to a different stored owner',true,async()=>{
  const h=harness()
  await nonThrowingRun(h,'4.2e1')
  assert.equal(h.reads.filter(x=>x.table==='memories').length,0,
    'scientific-notation owner was coerced into private memory query')
  assert.equal(h.writes.length,0)
})
await check('fractional account must not reach private memory query',true,async()=>{
  const h=harness()
  await nonThrowingRun(h,'42.5')
  assert.equal(h.reads.filter(x=>x.table==='memories').length,0)
})
await check('memory-disabled consent must prevent scanning historic meeting memories',true,async()=>{
  const h=harness({consent:[['42',{telegram_id:'42',memory_enabled:false}]]})
  await nonThrowingRun(h,'42')
  assert.equal(h.reads.filter(x=>x.table==='memories').length,0,
    'explicit disabled memory consent was bypassed')
  assert.equal(h.writes.length,0)
})
await check('unreadable consent must not authorize private memory scan',true,async()=>{
  const h=harness({consentError:{message:'synthetic-permission-denied'}})
  await nonThrowingRun(h,'42')
  assert.equal(h.reads.filter(x=>x.table==='memories').length,0,
    'unreadable consent was not treated as a fail-closed condition')
  assert.equal(h.writes.length,0)
})

console.log('MEETING MEMORY OWNER/CONSENT: controls '+controlPass+' pass, '+controlFail+
  ' fail; mandatory '+mandatoryPass+' pass, '+mandatoryFail+' fail')
if(controlFail)process.exitCode=2
else if(mandatoryFail)process.exitCode=1
