/**
 * TEST ONLY: original flight booking profile function in a sealed in-memory VM.
 * Expected safety RED until source owner checks are separately fixed and reviewed.
 * No network, provider, database, model, browser, send, or account changes.
 * Upstream resolveAgentActor already guards safe IDs: do not infer live reachability.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync('lib/agent/flight-booking.ts', 'utf8')
const tree = ts.createSourceFile('flight-booking.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const names = ['seatFromPreference', 'loadKnownDetails']
const nodes = new Map()
for (const node of tree.statements) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text))
    nodes.set(node.name.text, node.getText(tree).replace(/^export\s+/, ''))
}
for (const name of names) assert.ok(nodes.has(name), 'Missing actual source function: ' + name)
const js = ts.transpileModule([...nodes.values()].join('\n\n') + '\nmodule.exports = {loadKnownDetails}\n',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function fakeDb(fixtures) {
  const reads = []
  const db = { from(table) {
    assert.ok(Object.hasOwn(fixtures, table), 'Unexpected table ' + table)
    const clauses = []
    let one = false, n = Infinity, order = null
    const q = {
      select() { return q },
      eq(field, value) { clauses.push(['eq', field, value]); return q },
      gte(field, value) { clauses.push(['gte', field, value]); return q },
      ilike(field, value) { clauses.push(['ilike', field, value]); return q },
      order(field, opt) { order = [field, Boolean(opt?.ascending)]; return q },
      limit(value) { n = Number(value); return q },
      maybeSingle() { one = true; return q },
      then(resolve, reject) {
        reads.push({ table, clauses: clauses.map(c => [...c]) })
        let out = fixtures[table].filter(row => clauses.every(([op,field,value]) => {
          if (op === 'eq') return String(row[field]) === String(value)
          if (op === 'gte') return String(row[field] || '') >= String(value)
          if (op === 'ilike') return String(row[field] || '').toLowerCase().includes(String(value).toLowerCase().replaceAll('%', ''))
          return false
        }))
        if (order) out = out.toSorted((a,b) => order[1]
          ? String(a[order[0]] || '').localeCompare(String(b[order[0]] || ''))
          : String(b[order[0]] || '').localeCompare(String(a[order[0]] || '')))
        return Promise.resolve({data: one ? out[0] ?? null : out.slice(0,n), error:null}).then(resolve,reject)
      }
    }
    return q
  }}
  return {db, reads}
}
async function execute(fixtures, legacyTelegramId, userId) {
  const {db, reads} = fakeDb(fixtures)
  const sandbox = {module:{exports:{}},supabaseAdmin:db,Promise,Number,String,Date}
  vm.runInNewContext(js, sandbox, {filename:'original-flight-booking-test-only.cjs',timeout:1500})
  const actor = {legacyTelegramId,userId,whatsappId:'whatsapp:+919876543210',name:'Fixture'}
  const result = await sandbox.module.exports.loadKnownDetails(actor)
  return {result:result == null ? null : JSON.parse(JSON.stringify(result)),reads}
}
const A='9007199254740992', B='9007199254740993'
const now=new Date().toISOString()
const user=(id,name,email)=>({id:'uuid-'+id,telegram_id:id,name,email,gmail_email:null})
const base={
  users:[user('101','Safe Alpha','alpha@fixture.invalid'),user('202','Safe Bravo','bravo@fixture.invalid'),
    user(A,'Private Alpha','private-alpha@fixture.invalid'),user(B,'Private Bravo','private-bravo@fixture.invalid')],
  memories:[{telegram_id:'101',content:'I prefer a window seat',created_at:now},
    {telegram_id:'202',content:'I prefer an aisle seat',created_at:now},
    {telegram_id:A,content:'I prefer an aisle seat',created_at:now},
    {telegram_id:B,content:'I prefer a window seat',created_at:now}],
  user_preferences:[], conversations:[]
}
let controls=0, safetyReds=0, controlsFailed=0
async function check(kind,name,fn) {
  try {await fn();console.log('PASS ['+kind+'] '+name);if(kind==='CONTROL')controls++}
  catch(e){console.error('FAIL ['+kind+'] '+name+': '+String(e?.message||e).split('\n')[0]);
    if(kind==='SAFETY')safetyReds++;else controlsFailed++}
}
await check('CONTROL','safe A profile and seat',async()=>{
  const x=await execute(base,101,'uuid-101')
  assert.equal(x.result?.name,'Safe Alpha');assert.equal(x.result?.email,'alpha@fixture.invalid')
  assert.equal(x.result?.seat,'window')
  assert.ok(x.reads.every(r=>r.clauses.some(c=>c[1]==='telegram_id'&&String(c[2])==='101')))
})
await check('CONTROL','safe B profile and seat',async()=>{
  const x=await execute(base,202,'uuid-202')
  assert.equal(x.result?.name,'Safe Bravo');assert.equal(x.result?.email,'bravo@fixture.invalid')
  assert.equal(x.result?.seat,'aisle')
})
await check('CONTROL','missing safe user returns null',async()=>{
  assert.equal((await execute(base,303,'uuid-303')).result,null)
})
await check('CONTROL','typed email lookup remains on safe actor',async()=>{
  const fixture={...base,users:[...base.users.filter(u=>u.telegram_id!=='202'),user('202','Safe Bravo',null)],
    conversations:[{telegram_id:'202',role:'user',content:'bravo-typed@fixture.invalid',created_at:now}]}
  const x=await execute(fixture,202,'uuid-202')
  assert.equal(x.result?.email,'bravo-typed@fixture.invalid')
  assert.ok(x.reads.some(r=>r.table==='conversations'))
})
await check('SAFETY','64-bit owner B may not receive A private profile',async()=>{
  const x=await execute(base,B,'uuid-'+B)
  assert.ok(x.result===null||(x.result.name==='Private Bravo'&&x.result.email==='private-bravo@fixture.invalid'))
})
await check('SAFETY','already-rounded numeric owner must not query at all',async()=>{
  const x=await execute(base,Number(B),'uuid-'+B)
  assert.equal(x.result,null);assert.equal(x.reads.length,0)
})
await check('SAFETY','unsafe 64-bit string must fail before user/memory reads',async()=>{
  assert.equal((await execute(base,B,'uuid-'+B)).reads.length,0)
})
await check('SAFETY','unsafe B must not use A typed email fallback',async()=>{
  const fixture={...base,users:[...base.users.filter(u=>u.telegram_id!==A),user(A,'Private Alpha',null)],
    conversations:[{telegram_id:A,role:'user',content:'private-alpha-typed@fixture.invalid',created_at:now}]}
  const x=await execute(fixture,B,'uuid-'+B)
  assert.equal(x.result,null)
  assert.equal(x.reads.filter(r=>r.table==='conversations').length,0)
})
await check('SAFETY','unbound UUID cannot read a different UUID profile',async()=>{
  assert.equal((await execute(base,101,'uuid-202')).result,null)
})
await check('SAFETY','leading zeros cannot alias another owner',async()=>{
  const x=await execute(base,'00101','uuid-00101')
  assert.equal(x.result,null);assert.equal(x.reads.length,0)
})
await check('SAFETY','malformed owner must fail before private queries',async()=>{
  const x=await execute(base,'not-an-id','uuid-malformed')
  assert.equal(x.result,null);assert.equal(x.reads.length,0)
})
const upstream=readFileSync('lib/agent/actor.ts','utf8')
assert.match(upstream,/Number\.isSafeInteger\(/,'normal resolveAgentActor guard exists: no live reachability claim')
console.log('Source-executed synthetic only: '+controls+'/4 controls pass, '+safetyReds+'/7 required safety assertions RED; '+controlsFailed+' setup failures.')
if(safetyReds||controlsFailed)process.exitCode=1
