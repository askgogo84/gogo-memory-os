// Privacy regression: execute the ORIGINAL shipped memory-control handler with
// synthetic in-memory PostgREST fixtures. No production DB, credentials or users.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/bot/handlers/memory-control.ts', 'utf8')
let redactionModule = null
function realRedaction() {
  if (redactionModule) return redactionModule
  const js = ts.transpileModule(readFileSync('lib/bot/memory-redaction.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const exp = {}; vm.runInNewContext(js, { exports: exp, require: n => { throw Error('memory-redaction must stay import-free: ' + n) } }, { filename: 'lib/bot/memory-redaction.ts' })
  return (redactionModule = exp)
}
const compiled = ts.transpileModule(source, {
  fileName: 'lib/bot/handlers/memory-control.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture(initialMemories, options = {}) {
  const state = {
    memories: initialMemories.map(x => ({ ...x })),
    memory_embeddings: initialMemories.map(x => ({
      source_table: 'memories', source_id: String(x.id), deleted_at: null,
    })),
    user_insights: [{ telegram_id: 71, status: 'active' }, { telegram_id: 72, status: 'active' }],
    user_memory_profile: [
      { telegram_id: 71, common_times: ['9am'], preferences: { test: true } },
      { telegram_id: 72, common_times: ['8am'], preferences: { other: true } },
    ],
    reads: 0, deletes: 0, wrongOwnerDeletes: 0,
  }
  const fail = options.fail || null
  function from(table) {
    let action = 'read'
    let update = null
    let filters = []
    let range = null
    let cap = null
    let order = null
    const api = {
      select() { return api },
      eq(key, value) { filters.push(row => String(row[key]) === String(value)); return api },
      in(key, values) {
        const matched = new Set(values.map(String))
        filters.push(row => matched.has(String(row[key])))
        return api
      },
      is(key, value) { filters.push(row => row[key] === value); return api },
      order(key, opts = {}) { order = { key, ascending: opts.ascending !== false }; return api },
      range(from, to) { range = { from, to }; return api },
      limit(value) { cap = value; return api },
      delete() { action = 'delete'; return api },
      update(value) { action = 'update'; update = value; return api },
      then(resolve, reject) {
        const run = () => {
          if (!Array.isArray(state[table])) throw Error('Unexpected fixture table ' + table)
          if (fail && fail.table === table && fail.action === action)
            return { data: null, error: { message: 'synthetic DB error' } }
          let matches = state[table].filter(row => filters.every(test => test(row)))
          if (order) matches = matches.slice().sort((a,b) => {
            const result = String(a[order.key]).localeCompare(String(b[order.key]))
            return order.ascending ? result : -result
          })
          if (range) matches = matches.slice(range.from, range.to + 1)
          if (cap !== null) matches = matches.slice(0, cap)
          if (action === 'read') {
            if (table === 'memories') state.reads++
            return { data: matches.map(x => ({ ...x })), error: null }
          }
          if (action === 'update') {
            for (const row of matches) Object.assign(row, update)
            return { data: null, error: null }
          }
          if (action === 'delete') {
            state.deletes++
            const chosen = options.partialDelete ? matches.slice(0, 1) : matches
            for (const row of chosen) {
              if (String(row.telegram_id) !== '71') state.wrongOwnerDeletes++
            }
            const ids = new Set(chosen.map(row => String(row.id)))
            state[table] = state[table].filter(row => !ids.has(String(row.id)))
            return { data: chosen.map(x => ({ id: x.id })), error: null }
          }
          throw Error('Unknown action')
        }
        return Promise.resolve().then(run).then(resolve, reject)
      },
    }
    return api
  }
  const db = { from }
  const exports = {}
  const requireModule = name => {
    if (name === '@/lib/supabase-admin') return { supabaseAdmin: db }
    if (name === '@/lib/services/embeddings') return { embedText: async () => [] }
    if (name === '@/lib/bot/handlers/shared-memory') return { getSharedMemories: async () => [] }
    if (name === '@/lib/bot/memory-redaction') return realRedaction() // pure, import-free: the real module, not a stub
    throw Error('Unexpected import: ' + name)
  }
  vm.runInNewContext(compiled, { exports, require: requireModule, console, Date, Intl },
    { filename: 'lib/bot/handlers/memory-control.ts', timeout: 2000 })
  assert.equal(typeof exports.buildMemoryControlReply, 'function')
  return { reply: exports.buildMemoryControlReply, state }
}

const notes = count => Array.from({ length: count }, (_, i) => ({
  id: 'm' + String(i).padStart(4, '0'),
  telegram_id: 71,
  content: i === 0 ? 'Old oak tree secret' : 'My personal note number ' + i,
}))
const internal = Array.from({ length: 16 }, (_, i) => ({
  id: 'y' + String(i).padStart(4, '0'),
  telegram_id: 71,
  content: 'ASKGOGO_USAGE:ai_action:2026-11:' + i,
}))
const foreign = [
  { id: 'z001', telegram_id: 72, content: 'Foreign private note' },
  { id: 'z002', telegram_id: 72, content: 'Old oak tree secret for different owner' },
]

// More than one page; internal rows must survive; foreign owner is never touched.
{
  const { reply, state } = fixture([...notes(235), ...internal, ...foreign])
  const response = await reply(71, 'clear my memory')
  assert.match(response, /Memory cleared/)
  assert.equal(state.memories.filter(row => row.telegram_id === 71 && row.content.startsWith('My personal')).length, 0)
  assert.equal(state.memories.some(row => row.content === 'Old oak tree secret'), false)
  assert.equal(state.memories.filter(row => row.telegram_id === 71).length, internal.length)
  assert.equal(state.memories.filter(row => row.telegram_id === 72).length, foreign.length)
  assert.ok(state.reads >= 3, 'must read two initial pages and rescan for absence after delete')
  assert.ok(state.deletes >= 2, 'deletes must be bounded by batch')
  assert.equal(state.wrongOwnerDeletes, 0)
  assert.ok(state.memory_embeddings.filter(row => row.source_id.startsWith('m')).every(row => row.deleted_at))
  assert.ok(state.memory_embeddings.filter(row => row.source_id.startsWith('y')).every(row => row.deleted_at === null))
  assert.equal(state.user_insights.find(row => row.telegram_id === 71).status, 'deleted')
  assert.equal(state.user_insights.find(row => row.telegram_id === 72).status, 'active')
  assert.deepEqual(state.user_memory_profile.find(row => row.telegram_id === 72).preferences, { other: true })
  console.log('PASS clearing >200 owner notes, preserving system state and other owner')
}

// The oldest record is excluded by the old latest-50 query, but must be forgotten now.
{
  const { reply, state } = fixture([...notes(131), ...foreign])
  const response = await reply(71, 'forget oak tree secret')
  assert.match(response, /Forgotten/)
  assert.equal(state.memories.some(row => row.telegram_id === 71 && row.content === 'Old oak tree secret'), false)
  assert.equal(state.memories.filter(row => row.telegram_id === 71).length, 130)
  assert.equal(state.memories.filter(row => row.telegram_id === 72).length, foreign.length)
  assert.equal(state.wrongOwnerDeletes, 0)
  console.log('PASS targeted older-than-50 owner fact and no foreign deletion')
}

// A phrase with no actual target cannot turn into an unrestricted deletion.
{
  const { reply, state } = fixture([...notes(65), ...foreign])
  for (const command of ['delete memory', 'remove memory', 'forget about']) {
    const response = await reply(71, command)
    assert.match(response, /haven't deleted anything/i)
    assert.equal(state.deletes, 0)
  }
  assert.equal(state.memories.length, 65 + foreign.length)
  console.log('PASS empty forget targets never delete all notes')
}

for (const [description, opts, command] of [
  ['read outage', { fail: { table: 'memories', action: 'read' } }, 'forget everything'],
  ['delete outage', { fail: { table: 'memories', action: 'delete' } }, 'forget oak tree secret'],
  ['partial delete confirmation', { partialDelete: true }, 'forget everything'],
  ['embedding soft-delete failure', { fail: { table: 'memory_embeddings', action: 'update' } }, 'forget oak tree secret'],
  ['Memory Twin reset failure', { fail: { table: 'user_insights', action: 'update' } }, 'forget everything'],
]) {
  const { reply, state } = fixture([...notes(5), ...internal, ...foreign], opts)
  const response = await reply(71, command)
  assert.doesNotMatch(response, /Memory cleared|🧠 \*Forgotten\*/)
  assert.match(response, /couldn't verify/i)
  assert.equal(state.wrongOwnerDeletes, 0)
  assert.equal(state.memories.filter(row => row.telegram_id === 72).length, foreign.length)
  console.log('PASS no false success during ' + description)
}
console.log('memory-forget-retention: all synthetic original-handler checks passed')
