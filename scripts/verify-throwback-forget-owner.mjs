// Executes the original exported handler in a sandboxed synthetic DB. No customer data or real provider calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/bot/handlers/throwback.ts', 'utf8')
const compiled = ts.transpileModule(source, { fileName: 'lib/bot/handlers/throwback.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const OWNER = 71, FOREIGN = 72
const UNCERTAIN = /couldn.t verify.*fully forgotten/i

function fixture(options = {}) {
  const state = {
    embeddings: options.embedding === 'none' ? [] : [{ id: 'embedding-1', telegram_id: OWNER, source_id: 'memory-1', source_table: options.embedding === 'document' ? 'documents' : 'memories', resurfaced_at: '2026-10-20T00:00:00Z', deleted_at: null }],
    memories: options.memory === 'none' ? [] : [{ id: 'memory-1', telegram_id: options.memory === 'foreign' ? FOREIGN : OWNER }],
    calls: [],
  }
  const db = { from(table) {
    assert.ok(table === 'memories' || table === 'memory_embeddings')
    const tests = []
    let op = 'read', update = null, max = Infinity, sort = null
    const q = {
      select() { return q },
      eq(k, v) { tests.push(row => String(row[k]) === String(v)); return q },
      is(k, v) { tests.push(row => row[k] === v); return q },
      not(k, operator, v) { assert.equal(operator, 'is'); tests.push(row => row[k] !== v); return q },
      order(k, { ascending }) { sort = [k, ascending]; return q },
      limit(n) { max = n; return q },
      update(patch) { op = 'update'; update = patch; return q },
      delete() { op = 'delete'; return q },
      then(resolve, reject) {
        const run = () => {
          const stage = op === 'read' ? (table === 'memories' ? 'confirm-memory' : (tests.length >= 3 && state.calls.some(c => c.stage === 'mark') ? 'confirm-index' : 'read')) : (op === 'update' ? 'mark' : 'delete')
          state.calls.push({ table, stage })
          if (options.errorStage === stage) return { data: null, error: { message: 'inert DB failure at ' + stage } }
          if (options.throwStage === stage) throw Error('inert DB throw')
          const rows = (table === 'memories' ? state.memories : state.embeddings)
          let found = rows.filter(row => tests.every(fn => fn(row)))
          if (sort) found.sort((a,b) => { const cmp = String(a[sort[0]]).localeCompare(String(b[sort[0]])); return sort[1] ? cmp : -cmp })
          found = found.slice(0, max)
          if (op === 'update') {
            for (const row of found) Object.assign(row, update)
          } else if (op === 'delete' && options.phantomDelete !== true) {
            for (const row of found) rows.splice(rows.indexOf(row), 1)
          }
          return { data: found.map(x => ({ ...x })), error: null }
        }
        return Promise.resolve().then(run).then(resolve, reject)
      },
    }
    return q
  }}
  const module = { exports: {} }
  const requireStub = name => {
    if (name === '@/lib/supabase-admin') return { supabaseAdmin: db }
    if (name === './throwback-quality') return { eligibleThrowbackMemory: () => true }
    throw Error('unexpected import '+name)
  }
  vm.runInNewContext(compiled, { exports: module.exports, module, require: requireStub, console: { error(){} }, Date, Number, Array, Promise }, { timeout: 2000, filename: 'lib/bot/handlers/throwback.ts' })
  return { run: module.exports.handleThrowbackReply, state }
}

{
  const { run, state } = fixture()
  const reply = await run(OWNER, 'forget')
  assert.match(reply, /^Gone/)
  assert.equal(state.memories.length, 0)
  assert.ok(state.embeddings[0].deleted_at, 'index must be tombstoned')
  assert.deepEqual(state.calls.map(x=>x.stage), ['read', 'mark', 'delete', 'confirm-memory', 'confirm-index'])
  console.log('PASS confirmed exact-owner throwback deletion requires source and index readback')
}

for (const stage of ['read', 'mark', 'delete', 'confirm-memory', 'confirm-index']) {
  const { run, state } = fixture({ errorStage: stage })
  const reply = await run(OWNER, 'forget')
  assert.match(reply, UNCERTAIN, stage+' cannot claim success')
  if (stage === 'read' || stage === 'mark') assert.equal(state.memories.length, 1, 'failed index mark forbids source deletion')
  console.log('PASS DB '+stage+' failure is not falsely acknowledged')
}
{
  const { run } = fixture({ phantomDelete: true })
  assert.match(await run(OWNER, 'forget'), UNCERTAIN, 'DB no-op delete must fail source readback')
  console.log('PASS source still present after apparent delete is not reported as gone')
}
{
  const { run, state } = fixture({ memory: 'foreign' })
  assert.match(await run(OWNER, 'forget'), /^Gone/, 'owner’s index is hidden and own source absent')
  assert.deepEqual(state.memories, [{ id: 'memory-1', telegram_id: FOREIGN }], 'foreign memory is never deleted by source ID alone')
  console.log('PASS cross-account source ID cannot delete foreign-owner memory')
}
{
  const { run, state } = fixture({ embedding: 'document' })
  assert.match(await run(OWNER, 'forget'), /Nothing to forget/)
  assert.equal(state.memories.length, 1)
  console.log('PASS a nonmemory embedding is never treated as personal throwback')
}
{
  const { run, state } = fixture()
  assert.match(await run(Number('9007199254740993'), 'forget'), UNCERTAIN)
  assert.equal(state.calls.length, 0)
  assert.match(await run(OWNER, 'keep'), /Kept/)
  assert.equal(state.calls.length, 0)
  console.log('PASS ambiguous 64-bit numeric owner denied; keep remains no-write')
}
{
  const { run, state } = fixture({ throwStage: 'delete' })
  assert.match(await run(OWNER, 'forget'), UNCERTAIN)
  assert.ok(state.embeddings[0].deleted_at, 'uncertain source delete keeps index hidden')
  console.log('PASS thrown delete does not assert successful forget')
}
console.log('Throwback verified-owner forgetting: synthetic original-function regressions passed')
