// Inert, original-module Split command group resolution safety regression.
// No credentials, customer data, external calls or real DB mutations.
'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const ts = require('typescript')

const PHONE = 'whatsapp:+919876543210'
const FOREIGN = 'whatsapp:+19876543210'
const STOP = new Error('SYNTHETIC_STOP_BEFORE_DB_WRITE')
const group = (id, name, owner_phone = PHONE) => ({ id, name, owner_phone, currency: 'INR' })
const source = readFileSync('lib/splitwise/split-service.ts', 'utf8')
assert.match(source, /async function findGroup\(/)
assert.match(source, /export async function handleSplitCommand\(/)
const compiled = ts.transpileModule(source + '\nexport { findGroup as __inertFindGroup };\n', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

function harness(groups, options = {}) {
  const reads = [], writes = []
  const memberIds = options.memberIds || []
  const intent = options.intent || { type: 'settle', groupName: 'Goa', from: 'Me', to: 'Rahul', amount: 100, rawText: 'synthetic only' }
  const db = {
    from(table) {
      let fields = '', scope = '', limit = Infinity
      const filters = []
      const query = {
        select(value) { fields = value; return query },
        eq(key, value) { filters.push([key, value]); return query },
        or(value) { scope = value; return query },
        order() { return query },
        limit(value) { limit = value; return query },
        ilike() { throw new Error('Untrusted group text must never be passed to SQL ILIKE') },
        insert(values) {
          writes.push({ table, values })
          throw STOP // Block *before* any real mutation could occur.
        },
        then(resolve, reject) {
          let result
          if (table === 'split_group_members') {
            assert.ok(filters.some(([k, v]) => k === 'phone' && v === PHONE), 'exact phone membership scope')
            reads.push({ table, limit })
            result = options.memberError
              ? { data: null, error: { message: 'synthetic member read failure' } }
              : options.memberNull
                ? { data: null, error: null }
                : { data: memberIds.slice(0, limit).map(group_id => ({ group_id })), error: null }
          } else if (table === 'split_groups') {
            assert.ok(scope.includes('owner_phone.eq.' + PHONE), 'exact owner predicate required')
            assert.ok(scope.includes('id.in.('), 'joined-group access predicate required')
            reads.push({ table, fields, scope, limit })
            const allowed = groups.filter(g => g.owner_phone === PHONE || memberIds.includes(g.id))
            result = options.groupError
              ? { data: null, error: { message: 'synthetic group read failure' } }
              : options.groupNull
                ? { data: null, error: null }
                : { data: allowed.slice(0, limit), error: null }
          } else {
            throw new Error('Unexpected source read table: ' + table)
          }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return query
    },
  }
  const stubs = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/channels/whatsapp': { sendWhatsAppMessage() { throw new Error('NO_WHATSAPP_ALLOWED') } },
    './split-parser': { parseSplitIntent: () => intent, normalizeMemberName: value => String(value || '').trim() },
    './simplify-debts': { simplifyDebts() { throw new Error('NO_BALANCES_NEEDED') } },
  }
  const exports = {}
  new Function('require', 'exports', compiled)(
    path => { assert.ok(Object.hasOwn(stubs, path), 'unexpected import: ' + path); return stubs[path] },
    exports,
  )
  return {
    resolve: groupName => exports.__inertFindGroup(PHONE, groupName),
    settle: groupName => exports.handleSplitCommand(PHONE, 'synthetic settle command').then(x => x),
    reads, writes,
  }
}

let checks = 0
async function check(name, fn) { await fn(); checks++; console.log('PASS ' + name) }
async function selected(name, groups, query, expected, options = {}) {
  await check(name, async () => {
    const h = harness(groups, options)
    const result = await h.resolve(query)
    assert.equal(result?.id, expected, 'select exact intended group only')
    assert.equal(h.writes.length, 0)
    if (query !== undefined) {
      assert.ok(h.reads.every(r => r.limit <= 101), 'bounded queries required')
      assert.ok(h.reads.some(r => r.table === 'split_groups' && r.limit === 101))
    }
  })
}
async function unmatched(name, groups, query, options = {}) {
  await check(name, async () => {
    const h = harness(groups, options)
    assert.equal(await h.resolve(query), null)
    assert.equal(h.writes.length, 0)
  })
}
async function rejected(name, groups, query, error, options = {}) {
  await check(name, async () => {
    const h = harness(groups, options)
    await assert.rejects(() => h.resolve(query), new RegExp(error))
    assert.equal(h.writes.length, 0)
  })
}

async function main() {
  await unmatched('literal percent does not expand to every group', [group('a','Goa'), group('b','Holiday')], '%')
  await unmatched('literal underscore does not match GoaX2026', [group('a','GoaX2026')], 'Goa_2026')
  await selected('exact match beats more recent fuzzy and wildcard near-match',
    [group('wrong','GoaX2026'), group('right','Goa_2026'),group('partial','Holiday Goa_2026')], 'Goa_2026', 'right')
  await selected('normalized case and whitespace exact match',
    [group('right','Goa  2026')], '  gOA 2026 ', 'right')
  await selected('unique literal partial group remains supported',
    [group('right','Holiday in Mysore')], 'Mysore', 'right')
  await rejected('two normalized exact names cannot select arbitrary first row',
    [group('a','Holiday'), group('b','  HOLIDAY ')], 'Holiday', 'split_group_ambiguous')
  await rejected('two partial matches cannot select arbitrary newest row',
    [group('a','Mysore Weekend'),group('b','Mysore Dinner')], 'Mysore', 'split_group_ambiguous')
  await rejected('group lookup error fails closed', [group('a','Goa')], 'Goa',
    'split_group_lookup_unavailable', { groupError: true })
  await rejected('null group lookup fails closed', [group('a','Goa')], 'Goa',
    'split_group_lookup_unavailable', { groupNull: true })
  await rejected('101 accessible groups refuse silently incomplete uniqueness',
    Array.from({length:101},(_,i)=>group('id-'+i,i===0?'Goa':'Other '+i)), 'Goa',
    'split_group_lookup_unavailable')
  await rejected('membership lookup error fails closed', [group('a','Goa')], 'Goa',
    'split_group_lookup_unavailable', { memberError: true })
  await rejected('null membership lookup fails closed', [group('a','Goa')], 'Goa',
    'split_group_lookup_unavailable', { memberNull: true })
  await rejected('101 membership records refuse silently truncated access set',
    [group('a','Goa')], 'Goa', 'split_group_lookup_unavailable',
    { memberIds: Array.from({length:101},(_,i)=>'group-'+i) })
  await unmatched('foreign owner group is never selected',
    [group('foreign','Mysore',FOREIGN), group('own','Goa')], 'Mysore')
  await selected('joined group remains accessible using exact member membership',
    [group('shared','Mysore',FOREIGN)], 'Mysore', 'shared', { memberIds:['shared'] })
  await unmatched('blank explicit group does not select latest', [group('a','Goa')], '   ')

  await check('original settle handler cannot write to wildcard-selected group', async () => {
    const h = harness([group('wrong','GoaX2026')], {
      intent: { type: 'settle', groupName: 'Goa_2026', from:'Me',to:'Rahul',amount:100,rawText:'inert' },
    })
    assert.match(await h.settle(), /No split group found/i)
    assert.equal(h.writes.length, 0)
  })
  await check('original settle handler reaches ONLY the correct group before a blocked write', async () => {
    const h = harness([group('wrong','GoaX2026'),group('right','Goa_2026')], {
      intent: { type: 'settle', groupName: 'Goa_2026', from:'Me',to:'Rahul',amount:100,rawText:'inert' },
    })
    await assert.rejects(() => h.settle(), err => err === STOP)
    assert.equal(h.writes.length, 1)
    assert.equal(h.writes[0].table, 'split_settlements')
    assert.equal(h.writes[0].values.group_id, 'right')
  })
  await check('original settle handler fails closed before mutation on ambiguity', async () => {
    const h = harness([group('a','Goa 2026'),group('b','GOA 2026')], {
      intent: { type:'settle', groupName:'Goa 2026', from:'Me',to:'Rahul',amount:100,rawText:'inert' },
    })
    await assert.rejects(() => h.settle(), /split_group_ambiguous/)
    assert.equal(h.writes.length, 0)
  })
  console.log('SPLIT_COMMAND_GROUP_LITERAL: ' + checks + ' original-module inert cases PASS')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
