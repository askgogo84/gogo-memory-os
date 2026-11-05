// Source-executed, inert regression: a legacy TODO completion can change ONE owned task only.
// No live database, phone, credential, reminder, provider call or customer state.
'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const ts = require('typescript')
const source = readFileSync('app/api/todos/route.ts', 'utf8')
assert.match(source, /export async function POST/)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function harness(seed, opt = {}) {
  const records = seed.map(r => ({ done: false, ...r }))
  const reads = [], writes = []
  const supabase = {
    from(table) {
      assert.equal(table, 'todos')
      let filters = [], mode = 'read', patch
      const builder = {
        select(cols) {
          if (mode !== 'write') return builder
          writes.push({ filters: [...filters], patch, columns: cols })
          const names = new Map(filters)
          assert.equal(names.has('id'), true, 'all writes must identify one exact task')
          assert.equal(names.has('whatsapp_id'), true, 'all writes must bind exact owner')
          assert.equal(names.get('done'), false, 'writes must exclude completed tasks')
          if (opt.writeError) return Promise.resolve({ data: null, error: { message: 'synthetic update failure' } })
          const matched = records.filter(r => filters.every(([k,v]) => r[k] === v))
          matched.forEach(r => Object.assign(r, patch))
          const rows = opt.noReceipt ? null :
            opt.wrongReceipt ? [{ id: 'unrelated-id', text: 'other' }] :
            opt.multipleReceipts ? [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] :
            matched.map(r => ({ id: r.id, text: r.text }))
          return Promise.resolve({ data: rows, error: null })
        },
        eq(k,v) { filters.push([k,v]); return builder },
        limit(n) {
          reads.push({ filters: [...filters], limit: n })
          const names = new Map(filters)
          assert.equal(names.has('whatsapp_id'), true, 'read must bind owner')
          assert.equal(names.get('done'), false, 'read only pending tasks')
          if (opt.readError) return Promise.resolve({ data: null, error: { message: 'synthetic read error' } })
          if (opt.nullRead) return Promise.resolve({ data: null, error: null })
          const found = opt.overrideRead || records.filter(r => filters.every(([k,v]) => r[k] === v)).slice(0,n)
          return Promise.resolve({ data: found, error: null })
        },
        update(fields) { mode = 'write'; patch = fields; return builder },
        ilike() { throw Error('forbidden SQL wildcard task mutation') },
        or() { throw Error('forbidden unscoped task mutation') },
      }
      return builder
    },
  }
  const fakeModules = {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status || 200 }) } },
    '@supabase/supabase-js': { createClient: () => supabase },
    '@/lib/security/cron-auth': { isInternalServiceAuthorized: req => req.authorized === true },
  }
  const exports = {}
  new Function('require', 'exports', 'process', compiled)(
    p => { assert.ok(Object.hasOwn(fakeModules,p), 'unexpected dependency ' + p); return fakeModules[p] },
    exports,
    { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' } },
  )
  return { records, reads, writes, post: (body, authorized=true) => exports.POST({ authorized, json: async () => body }) }
}
const twoOwners = [
  {id:'rent-a',whatsapp_id:'whatsapp:+919876543210',text:'Pay rent'},
  {id:'insurance-a',whatsapp_id:'whatsapp:+919876543210',text:'Pay insurance'},
  {id:'rent-b',whatsapp_id:'whatsapp:+19876543210',text:'Pay rent'},
]
const owner = 'whatsapp:+919876543210'
async function check(name, run) { await run(); console.log('PASS ' + name) }
async function main() {
  await check('missing internal auth denies without any owner reads or writes',async()=>{
    const h=harness(twoOwners)
    const r=await h.post({phone:owner,action:'done',text:'Pay rent'},false)
    assert.equal(r.status,401); assert.equal(h.reads.length,0);assert.equal(h.writes.length,0)
  })
  await check('exact title selects one task and never a different country owner',async()=>{
    const h=harness(twoOwners)
    const r=await h.post({phone:owner,action:'done',text:'  PAY   RENT '})
    assert.equal(r.body.ok,true);assert.equal(r.body.reply,'Marked done: Pay rent')
    assert.equal(h.writes.length,1);assert.equal(new Map(h.writes[0].filters).get('id'),'rent-a')
    assert.equal(h.records.find(x=>x.id==='rent-a').done,true)
    assert.equal(h.records.find(x=>x.id==='insurance-a').done,false)
    assert.equal(h.records.find(x=>x.id==='rent-b').done,false)
  })
  await check('unique partial phrase selects one item only',async()=>{
    const h=harness(twoOwners)
    const r=await h.post({phone:owner,action:'done',text:'insurance'})
    assert.equal(r.body.ok,true)
    assert.equal(h.writes.length,1);assert.equal(new Map(h.writes[0].filters).get('id'),'insurance-a')
  })
  await check('ambiguous partial match never updates either task',async()=>{
    const h=harness(twoOwners)
    const r=await h.post({phone:owner,action:'done',text:'pay'})
    assert.equal(r.body.ok,false);assert.match(r.body.reply,/More than one task matches/)
    assert.equal(h.writes.length,0);assert.ok(h.records.every(x=>!x.done))
  })
  await check('LIKE wildcard percent and underscore are literal, not a SQL pattern',async()=>{
    for(const input of ['%','_','%ay','pay_']){
      const h=harness(twoOwners)
      const r=await h.post({phone:owner,action:'done',text:input})
      assert.equal(r.body.ok,false,input);assert.equal(h.writes.length,0,input)
    }
  })
  await check('duplicates with identical exact text are ambiguous',async()=>{
    const h=harness([...twoOwners,{id:'rent-copy',whatsapp_id:owner,text:'Pay rent'}])
    const r=await h.post({phone:owner,action:'done',text:'pay rent'})
    assert.equal(r.body.ok,false);assert.equal(h.writes.length,0)
  })
  await check('blank, wrong type and excessive input never query',async()=>{
    for(const input of ['', ' \t ', null, 4, 'x'.repeat(161)]){
      const h=harness(twoOwners)
      const r=await h.post({phone:owner,action:'done',text:input})
      assert.equal(r.body.ok,false);assert.equal(h.reads.length,0);assert.equal(h.writes.length,0)
    }
  })
  await check('missing matching item never claims done',async()=>{
    const h=harness(twoOwners)
    const r=await h.post({phone:owner,action:'done',text:'fly to Mars'})
    assert.equal(r.body.ok,false);assert.equal(h.writes.length,0)
  })
  await check('failed or unknown read never updates',async()=>{
    for(const opt of [{readError:true},{nullRead:true}]){
      const h=harness(twoOwners,opt)
      const r=await h.post({phone:owner,action:'done',text:'Pay rent'})
      assert.equal(r.body.ok,false);assert.equal(h.writes.length,0)
    }
  })
  await check('truncated 101-task read never claims unique match',async()=>{
    const many=Array.from({length:101},(_,i)=>({id:'i'+i,whatsapp_id:owner,text:i===0?'Pay rent':'Task '+i}))
    const h=harness(many)
    const r=await h.post({phone:owner,action:'done',text:'Pay rent'})
    assert.equal(r.body.ok,false);assert.equal(h.writes.length,0)
  })
  await check('unsafe numeric task ID cannot alias another task',async()=>{
    const h=harness([{id:9007199254740992,whatsapp_id:owner,text:'Pay rent'}])
    const r=await h.post({phone:owner,action:'done',text:'Pay rent'})
    assert.equal(r.body.ok,false);assert.equal(h.writes.length,0)
  })
  await check('update error and absent, mismatched or multiple receipts do not claim done',async()=>{
    for(const opt of [{writeError:true},{noReceipt:true},{wrongReceipt:true},{multipleReceipts:true}]){
      const h=harness(twoOwners,opt)
      const r=await h.post({phone:owner,action:'done',text:'Pay rent'})
      assert.equal(r.body.ok,false);assert.doesNotMatch(String(r.body.reply||''),/Marked done/i)
      assert.equal(h.writes.length,1)
    }
  })
  console.log('TODO_DONE_SINGLE_OWNER_LITERAL: 12 inert original-handler case classes PASS')
}
main().catch(error=>{console.error(error);process.exitCode=1})
