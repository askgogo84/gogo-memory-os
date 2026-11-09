// Source-level retention regression. Executes original memory-index TypeScript in
// an inert VM; no production DB, memory contents, credentials or embedding calls.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/services/memory-index.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  fileName: 'lib/services/memory-index.ts',
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function fixture(options = {}) {
  const state = {
    memories: new Map(), embeddings: new Map(), events: [], embedded: 0,
    upserts: 0, errors: [], sourceReads: 0,
  }
  const OWNER = 71, FOREIGN = 72
  if (options.source !== 'missing') state.memories.set('original', { id: 'original', telegram_id: options.source === 'foreign' ? FOREIGN : OWNER })
  const selection = (table, filters) => {
    const records = table === 'memories' ? [...state.memories.values()] : [...state.embeddings.values()]
    return records.filter(record => filters.every(([k, v, type]) => type === 'is' ? record[k] === v : String(record[k]) === String(v)))
  }
  const db = {
    from(table) {
      assert.ok(['memories', 'memory_embeddings'].includes(table), 'unexpected table '+table)
      let filters = [], updateValue = null, limit = null
      const query = {
        select() { return query },
        eq(key, value) { filters.push([key, value, 'eq']); return query },
        is(key, value) { filters.push([key, value, 'is']); return query },
        limit(value) { limit = value; return query },
        async maybeSingle() {
          assert.equal(table, 'memories')
          state.sourceReads++
          if (options.sourceReadErrorAt === state.sourceReads) return { data: null, error: { message: 'synthetic source read failure' } }
          const row = selection(table, filters)[0] || null
          state.events.push('source:'+Boolean(row))
          return { data: row && { id: row.id }, error: null }
        },
        async upsert(item) {
          assert.equal(table, 'memory_embeddings')
          state.upserts++
          if (options.onUpsert) options.onUpsert(state)
          state.embeddings.set(item.source_table+':'+item.source_id, { ...item })
          state.events.push('upsert')
          return { data: null, error: null }
        },
        update(value) { updateValue = value; return query },
        then(resolve, reject) {
          const run = () => {
            let rows = selection(table, filters)
            if (limit !== null) rows = rows.slice(0, limit)
            if (updateValue !== null) {
              assert.equal(table, 'memory_embeddings')
              if (options.tombstoneError) return { data: null, error: { message: 'synthetic tombstone failure' } }
              rows.forEach(row => Object.assign(row, updateValue))
              state.events.push('tombstone')
              return { data: null, error: null }
            }
            return { data: rows.map(row => ({ ...row })), error: null }
          }
          return Promise.resolve().then(run).then(resolve, reject)
        },
      }
      return query
    },
  }
  const module = { exports: {} }
  const fakeRequire = name => {
    if (name === '@/lib/supabase-admin') return { supabaseAdmin: db }
    if (name === '@/lib/bot/memory-redaction') return { isSecretShapedMemory: () => false }
    if (name === '@/lib/services/embeddings') return { embedText: async () => {
      state.embedded++
      state.events.push('embed')
      if (options.onEmbed) options.onEmbed(state)
      return [0.1, 0.2]
    } }
    throw Error('unexpected import: '+name)
  }
  const quietConsole = { error: (...args) => state.errors.push(args.join(' ')), log: () => {} }
  vm.runInNewContext(compiled, { module, exports: module.exports, require: fakeRequire,
    console: quietConsole, Date }, { filename: 'lib/services/memory-index.ts', timeout: 2000 })
  assert.equal(typeof module.exports.indexMemory, 'function')
  return { index: module.exports.indexMemory, state, OWNER, FOREIGN }
}

const note = { telegramId: 71, sourceTable: 'memories', sourceId: 'original', content: 'Synthetic garden note' }
const key = 'memories:original'

// A valid owner can still create a live index. Its source is checked before
// the embed, again after the embed, and after the final DB upsert.
{
  const { index, state } = fixture()
  await index(note)
  assert.equal(state.embedded, 1)
  assert.equal(state.upserts, 1)
  assert.equal(state.sourceReads, 3)
  assert.equal(state.embeddings.get(key)?.deleted_at, null)
  console.log('PASS active exact-owner memory indexed and verified')
}

// Never embed or index an already-forgotten or foreign-owner source.
for (const source of ['missing', 'foreign']) {
  const { index, state } = fixture({ source })
  await index(note)
  assert.equal(state.embedded, 0)
  assert.equal(state.upserts, 0)
  assert.equal(state.embeddings.size, 0)
  console.log('PASS no provider egress/index for '+source+' source')
}

// The note disappears while a slow external embed is running. The old
// implementation would UPSERT the forgotten content as a live searchable row.
{
  const { index, state } = fixture({ onEmbed: state => state.memories.delete('original') })
  await index(note)
  assert.equal(state.embedded, 1)
  assert.equal(state.upserts, 0)
  assert.equal(state.embeddings.size, 0)
  console.log('PASS forget during embedding cannot revive the index')
}

// The note disappears after the last pre-upsert check but before the write.
// Original code must find and soft-delete the stale embedding afterwards.
{
  const { index, state } = fixture({ onUpsert: state => state.memories.delete('original') })
  await index(note)
  assert.equal(state.upserts, 1)
  assert.ok(state.embeddings.get(key)?.deleted_at, 'late indexed row must be tombstoned')
  assert.ok(state.events.includes('tombstone'))
  console.log('PASS post-upsert owner check tombstones concurrent forget')
}

// A read error after upsert is NOT evidence the source still exists.
{
  const { index, state } = fixture({ sourceReadErrorAt: 3 })
  await index(note)
  assert.equal(state.upserts, 1)
  assert.ok(state.embeddings.get(key)?.deleted_at)
  console.log('PASS uncertain final source check conservatively tombstones')
}

// Storage failures are reported to diagnostics, never claimed as verified.
{
  const { index, state } = fixture({ onUpsert: state => state.memories.delete('original'), tombstoneError: true })
  await index(note)
  assert.ok(state.errors.some(x => x.includes('memory_index_forget_tombstone_failed')))
  console.log('PASS failed tombstone is explicitly reported, not silently verified')
}

// Guard is limited to memories; other supported index sources keep their
// existing behavior and do not need a memories-row lookup.
{
  const { index, state } = fixture({ source: 'missing' })
  await index({ ...note, sourceTable: 'documents', sourceId: 'doc-one' })
  assert.equal(state.sourceReads, 0)
  assert.equal(state.upserts, 1)
  assert.equal(state.embeddings.get('documents:doc-one')?.source_id, 'doc-one')
  console.log('PASS document index behavior unchanged')
}

// A rounded numeric owner cannot be treated as verified for a source lookup.
{
  const { index, state } = fixture()
  await index({ ...note, telegramId: 9007199254740993 })
  assert.equal(state.embedded, 0)
  assert.equal(state.upserts, 0)
  assert.ok(state.errors.some(x => x.includes('memory_index_owner_invalid')))
  console.log('PASS unsafe numeric owner fails closed')
}
console.log('memory-index-forget-race: all original-function synthetic checks passed')
