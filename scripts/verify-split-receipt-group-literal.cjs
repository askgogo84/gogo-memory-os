// Inert, source-executed Split receipt group-selection regression.
// No production DB, customer rows, WhatsApp, payments, credentials or real writes.
'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const ts = require('typescript')
const source = readFileSync('lib/splitwise/receipt-itemizer.ts', 'utf8')
assert.match(source, /export async function addScannedReceiptToSplit/)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

const PHONE = 'whatsapp:+919876543210'
const FOREIGN = 'whatsapp:+19876543210'
const STOP = new Error('SYNTHETIC_STOP_BEFORE_DB_WRITE')
const group = (id, name, owner_phone = PHONE) => ({ id, name, owner_phone, currency: 'INR' })

function harness(groups, options = {}) {
  const reads = [], writes = []
  const memberIds = options.memberIds || []
  const db = {
    from(table) {
      let fields = '', scope = '', limit = Infinity, filters = []
      const query = {
        select(value) { fields = value; return query },
        eq(key, value) { filters.push([key, value]); return query },
        or(value) { scope = value; return query },
        order() { return query },
        limit(value) { limit = value; return query },
        ilike() { throw new Error('Untrusted group text must not be SQL LIKE') },
        insert(values) {
          writes.push({ table, values })
          // No mutation ever executes. Stop before the source invokes the DB insert.
          throw STOP
        },
        then(resolve, reject) {
          let result
          if (table === 'split_group_members') {
            const phoneFilter = filters.find(([k]) => k === 'phone')
            if (phoneFilter) {
              assert.equal(phoneFilter[1], PHONE)
              result = { data: memberIds.map(group_id => ({ group_id })), error: null }
            } else {
              const groupFilter = filters.find(([k]) => k === 'group_id')
              assert.ok(groupFilter)
              result = { data: [{ name: 'Me', phone: PHONE }], error: null }
            }
          } else if (table === 'split_groups') {
            assert.ok(scope.includes('owner_phone.eq.' + PHONE), 'require owner predicate')
            assert.ok(scope.includes('id.in.('), 'preserve membership-bound access')
            reads.push({ fields, scope, limit })
            const accessible = groups.filter(g => g.owner_phone === PHONE || memberIds.includes(g.id))
            result = options.readError
              ? { data: null, error: { message: 'synthetic read error' } }
              : options.nullRead
                ? { data: null, error: null }
                : { data: accessible.slice(0, limit), error: null }
          } else {
            throw new Error('Unexpected DB read: ' + table)
          }
          return Promise.resolve(result).then(resolve, reject)
        },
      }
      return query
    },
  }
  const modules = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    './split-parser': { normalizeMemberName: x => String(x || '').trim() },
  }
  const exports = {}
  new Function('require', 'exports', compiled)(
    path => { assert.ok(Object.hasOwn(modules, path), 'unexpected import ' + path); return modules[path] },
    exports,
  )
  const save = (groupName) => exports.addScannedReceiptToSplit({
    ownerPhone: PHONE, groupName, receipt: { merchant: 'Synthetic dinner', total: 600, currency: 'INR', items: [] },
  })
  return { save, reads, writes }
}

async function check(name, run) { await run(); console.log('PASS ' + name) }
async function noWrite(name, groups, groupName, options = {}) {
  await check(name, async () => {
    const h = harness(groups, options)
    const result = await h.save(groupName)
    assert.equal(result.group, null)
    assert.match(result.reply, /couldn't find a split group/i)
    assert.equal(h.writes.length, 0)
    assert.equal(h.reads[0].limit, 101, 'bounded complete owned-group read required')
  })
}
async function selectedGroup(name, groups, query, expectedId, options = {}) {
  await check(name, async () => {
    const h = harness(groups, options)
    await assert.rejects(() => h.save(query), err => err === STOP)
    assert.equal(h.writes.length, 1, 'source must only reach first synthetic expense write')
    assert.equal(h.writes[0].table, 'split_expenses')
    assert.equal(h.writes[0].values.group_id, expectedId)
    if (query) assert.equal(h.reads[0].limit, 101)
  })
}
async function errorNoWrite(name, groups, query, error, options = {}) {
  await check(name, async () => {
    const h = harness(groups, options)
    await assert.rejects(() => h.save(query), new RegExp(error))
    assert.equal(h.writes.length, 0)
  })
}

async function run() {
  await noWrite('missing explicitly named group never falls back to latest', [group('latest','Goa')], 'Mysore')
  await noWrite('percent user input is not an SQL wildcard', [group('latest','Goa'), group('other','Holiday')], '%')
  await noWrite('underscore user input is not an SQL wildcard', [group('latest','GoaX2026')], 'Goa_2026')
  await selectedGroup('literal exact beats newer wildcard-like name',
    [group('wrong','GoaX2026'), group('right','Goa_2026')], 'Goa_2026', 'right')
  await selectedGroup('case and whitespace normalisation match one exact group',
    [group('right','Goa  2026')], '  gOA 2026 ', 'right')
  await selectedGroup('a unique literal substring still resolves',
    [group('right','Holiday in Mysore')], 'Mysore', 'right')
  await errorNoWrite('two partial matches refuse ambiguous expense',
    [group('a','Holiday Mysore'),group('b','Mysore Dinner')], 'Mysore','split_group_ambiguous')
  await errorNoWrite('two normalized exact matches refuse arbitrary first row',
    [group('a','Holiday'),group('b','  HOLIDAY ')], 'Holiday','split_group_ambiguous')
  await errorNoWrite('owner group read error prevents write', [group('a','Goa')], 'Goa',
    'split_group_lookup_unavailable',{ readError: true })
  await errorNoWrite('null owner group result prevents write', [group('a','Goa')], 'Goa',
    'split_group_lookup_unavailable',{ nullRead: true })
  await errorNoWrite('101 accessible groups must not claim a unique match',
    Array.from({length:101},(_,i)=>group('id-'+i,i===0?'Goa':'Group '+i)), 'Goa','split_group_lookup_unavailable')
  await noWrite('foreign-owner group never chosen by named lookup', [group('foreign','Mysore',FOREIGN), group('own','Goa')], 'Mysore')
  await selectedGroup('joined-group access remains supported',
    [group('joined','Mysore',FOREIGN)], 'Mysore', 'joined', { memberIds: ['joined'] })
  await selectedGroup('unnamed receipt retains legacy latest-group selection',
    [group('latest','Goa')], undefined, 'latest')
  console.log('SPLIT_RECEIPT_GROUP_LITERAL: 14 original-source inert case classes PASS')
}
run().catch(error => { console.error(error); process.exitCode = 1 })
