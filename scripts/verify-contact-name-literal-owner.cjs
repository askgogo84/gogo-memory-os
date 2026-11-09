// Inert original-handler contact-memory regression: literal names, owner binding, mutation receipts.
// No live contacts, external calls, credentials, messages or account changes.
'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const ts = require('typescript')
const source = readFileSync('app/api/contacts/route.ts', 'utf8')
assert.match(source, /export async function POST/)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const ownerA = 'whatsapp:+919876543210'
const ownerB = 'whatsapp:+19876543210'
const baseRows = [
  { id: 'a1', whatsapp_id: ownerA, name: 'A_B', facts: ['likes tea'] },
  { id: 'a2', whatsapp_id: ownerA, name: 'AxB', facts: ['likes juice'] },
  { id: 'a3', whatsapp_id: ownerA, name: 'Mary Smith', facts: ['likes hiking'] },
  { id: 'b1', whatsapp_id: ownerB, name: 'A_B', facts: ['confidential B'] },
]
const clone = x => JSON.parse(JSON.stringify(x))
function harness(seed = baseRows, opt = {}) {
  const records = clone(seed)
  const reads = [], writes = [], inserts = []
  const supabase = {
    from(table) {
      assert.equal(table, 'contact_memory')
      let mode = 'read', filters = [], patch = null, rowToInsert = null
      const matched = () => records.filter(row => filters.every(([key, value]) => row[key] === value))
      const builder = {
        select(columns) {
          if (mode === 'read') return builder
          if (mode === 'write') {
            writes.push({ filters: [...filters], patch, columns })
            const f = new Map(filters)
            assert.ok(f.has('id'), 'writes must target an exact contact id')
            assert.ok(f.has('whatsapp_id'), 'writes must bind owner')
            if (opt.writeError) return Promise.resolve({ data: null, error: new Error('synthetic write failure') })
            const found = matched()
            found.forEach(x => Object.assign(x, patch))
            let data = found.map(x => ({ id: x.id, whatsapp_id: x.whatsapp_id, facts: x.facts }))
            if (opt.noWriteReceipt) data = null
            if (opt.wrongWriteReceipt) data = [{ id: 'unrelated', whatsapp_id: ownerA, facts: ['likes tea'] }]
            if (opt.multiWriteReceipt) data = [data[0], data[0]]
            if (opt.badFactsReceipt) data = [{ id: found[0]?.id, whatsapp_id: ownerA, facts: [] }]
            return Promise.resolve({ data, error: null })
          }
          if (mode === 'insert') {
            inserts.push({ ...rowToInsert })
            if (opt.insertError) return Promise.resolve({ data: null, error: new Error('synthetic insert failure') })
            const inserted = { id: 'inserted-a', ...rowToInsert }
            records.push(inserted)
            let data = [clone(inserted)]
            if (opt.noInsertReceipt) data = null
            if (opt.wrongInsertReceipt) data = [{ ...inserted, whatsapp_id: ownerB }]
            return Promise.resolve({ data, error: null })
          }
          throw new Error('unexpected select mode')
        },
        eq(key, value) { filters.push([key, value]); return builder },
        limit(n) {
          reads.push({ filters: [...filters], n })
          assert.equal(new Map(filters).get('whatsapp_id'), opt.expectedOwner || ownerA, 'read must bind exact requesting owner')
          assert.equal(n, 101, 'read must detect saturation instead of treating it as no-match')
          if (opt.readError) return Promise.resolve({ data: null, error: new Error('synthetic read failure') })
          if (opt.nullRead) return Promise.resolve({ data: null, error: null })
          return Promise.resolve({ data: clone(matched().slice(0, n)), error: null })
        },
        update(p) { mode = 'write'; patch = p; return builder },
        insert(p) { mode = 'insert'; rowToInsert = p; return builder },
        ilike() { throw new Error('contact name must never be interpreted as SQL LIKE') },
        or() { throw new Error('contact read must not cross owners') },
        order() { return builder },
      }
      return builder
    },
  }
  const modules = {
    'next/server': { NextResponse: { json: (body, settings) => ({ body, status: settings?.status || 200 }) } },
    '@supabase/supabase-js': { createClient: () => supabase },
    '@/lib/security/cron-auth': { isInternalServiceAuthorized: req => req.authorized === true },
  }
  const exports = {}
  new Function('require', 'exports', 'process', compiled)(
    name => { assert.ok(Object.hasOwn(modules, name), 'unexpected dependency ' + name); return modules[name] },
    exports,
    { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' } }
  )
  return { records, reads, writes, inserts,
    post: (body, authorized = true) => exports.POST({ authorized, json: async () => body }) }
}

async function check(label, fn) { await fn(); console.log('PASS ' + label) }
async function run() {
  await check('unauthorized cannot even read a contact', async () => {
    const h = harness()
    const r = await h.post({phone:ownerA,action:'save',name:'A_B',fact:'new'}, false)
    assert.equal(r.status,401);assert.equal(h.reads.length,0);assert.equal(h.writes.length,0)
  })
  await check('underscore is a literal name and exact-owner write cannot touch AxB or foreign A_B', async () => {
    const h = harness()
    const r = await h.post({phone:ownerA,action:'save',name:'A_B',fact:'likes coffee'})
    assert.equal(r.body.ok,true)
    assert.equal(h.writes.length,1)
    assert.equal(new Map(h.writes[0].filters).get('id'),'a1')
    assert.deepEqual(h.records.find(x=>x.id==='a1').facts,['likes tea','likes coffee'])
    assert.deepEqual(h.records.find(x=>x.id==='a2').facts,['likes juice'])
    assert.deepEqual(h.records.find(x=>x.id==='b1').facts,['confidential B'])
  })
  await check('literal percent contact name cannot mutate different contact', async () => {
    const h = harness()
    const r = await h.post({phone:ownerA,action:'save',name:'%',fact:'likes art'})
    assert.equal(r.body.ok,true);assert.equal(h.writes.length,0);assert.equal(h.inserts.length,1)
    assert.equal(h.records.find(x=>x.id==='a1').facts.length,1)
  })
  await check('case-folded whitespace-normalised exact name picks one owner contact', async () => {
    const h = harness()
    const r=await h.post({phone:ownerA,action:'save',name:'  mArY  sMiTh ',fact:'likes tea'})
    assert.equal(r.body.ok,true);assert.equal(new Map(h.writes[0].filters).get('id'),'a3')
  })
  await check('duplicate exact owner contact names refuse mutation', async () => {
    const h=harness([...baseRows,{id:'a4',whatsapp_id:ownerA,name:' a_b ',facts:['other']}])
    const r=await h.post({phone:ownerA,action:'save',name:'A_B',fact:'likes tea'})
    assert.equal(r.status,409);assert.equal(h.writes.length,0);assert.equal(h.inserts.length,0)
  })
  await check('read errors, null reads, and owner read saturation fail closed', async () => {
    for (const opt of [{readError:true},{nullRead:true}]) {
      const h=harness(baseRows,opt)
      const r=await h.post({phone:ownerA,action:'save',name:'A_B',fact:'new'})
      assert.equal(r.status,503);assert.equal(h.writes.length,0)
    }
    const many=Array.from({length:101},(_,i)=>({id:'c'+i,whatsapp_id:ownerA,name:'contact '+i,facts:[]}))
    const h=harness(many)
    const r=await h.post({phone:ownerA,action:'save',name:'contact 0',fact:'new'})
    assert.equal(r.status,503);assert.equal(h.writes.length,0)
  })
  await check('unknown, failed, wrong, multi and bad-fact write receipts never claim success', async () => {
    for (const opt of [{writeError:true},{noWriteReceipt:true},{wrongWriteReceipt:true},{multiWriteReceipt:true},{badFactsReceipt:true}]) {
      const h=harness(baseRows,opt)
      const r=await h.post({phone:ownerA,action:'save',name:'A_B',fact:'likes coffee'})
      assert.equal(r.status,503);assert.equal(r.body.ok,false);assert.equal(h.writes.length,1)
    }
  })
  await check('verified new contact insert and owner receipt', async () => {
    const h=harness()
    const r=await h.post({phone:ownerA,action:'save',name:'Priya',fact:'likes mangoes'})
    assert.equal(r.body.ok,true);assert.equal(h.inserts.length,1)
    assert.equal(h.records.find(x=>x.name==='Priya').whatsapp_id,ownerA)
  })
  await check('unverified, failed or wrong-owner insert receipts never claim saved', async () => {
    for (const opt of [{insertError:true},{noInsertReceipt:true},{wrongInsertReceipt:true}]) {
      const h=harness(baseRows,opt)
      const r=await h.post({phone:ownerA,action:'save',name:'Priya',fact:'likes mangoes'})
      assert.equal(r.status,503);assert.equal(r.body.ok,false);assert.equal(h.inserts.length,opt.insertError?1:1)
    }
  })
  await check('recall exact underscore cannot expose AxB or other owner', async () => {
    const h=harness()
    const r=await h.post({phone:ownerA,action:'recall',query:'A_B'})
    assert.match(r.body.reply,/likes tea/);assert.doesNotMatch(r.body.reply,/juice|confidential B/)
  })
  await check('recall partial unique works but ambiguous query and % wildcard do not reveal facts', async () => {
    const h=harness()
    const a=await h.post({phone:ownerA,action:'recall',query:'Mary'})
    assert.match(a.body.reply,/likes hiking/)
    const b=await h.post({phone:ownerA,action:'recall',query:'A'})
    assert.match(b.body.reply,/More than one/);assert.doesNotMatch(b.body.reply,/likes tea|juice/)
    const c=await h.post({phone:ownerA,action:'recall',query:'%'})
    assert.match(c.body.reply,/No notes/);assert.doesNotMatch(c.body.reply,/likes tea|juice/)
  })
  await check('invalid names, facts and owner never touch database', async () => {
    for (const body of [
      {phone:ownerA,action:'save',name:'',fact:'ok'},
      {phone:ownerA,action:'save',name:'Priya',fact:''},
      {phone:ownerA,action:'save',name:'N'.repeat(121),fact:'ok'},
      {phone:ownerA,action:'save',name:12,fact:'ok'},
      {phone:ownerA,action:'recall',query:'  '},
      {phone:'',action:'save',name:'Priya',fact:'ok'},
    ]) {
      const h=harness()
      const r=await h.post(body)
      assert.equal(r.status,400);assert.equal(h.reads.length,0);assert.equal(h.writes.length,0)
    }
  })
  console.log('CONTACT_NAME_LITERAL_OWNER: 12 original-handler inert case classes PASS')
}
run().catch(e=>{console.error(e);process.exitCode=1})
