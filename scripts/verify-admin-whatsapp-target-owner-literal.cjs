// Inert original-module regression for WhatsApp ADMIN target-owner isolation.
// NO live database, WhatsApp, payments, credentials or account changes.
'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const ts = require('typescript')

const source = readFileSync('lib/bot/handlers/admin-analytics.ts', 'utf8')
assert.match(source, /async function findUserByPhone/, 'real production function exists')
assert.match(source, /async function buildAdminPlanChangeReply/, 'real admin mutation caller exists')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText

const indian = { id: 'ind-owner', telegram_id: 200, whatsapp_id: 'whatsapp:+919876543210', tier: 'free', name: 'Indian User' }
const american = { id: 'us-owner', telegram_id: 100, whatsapp_id: 'whatsapp:+19876543210', tier: 'pro', name: 'US User' }
// Both distinct accounts have the SAME final ten digits. Previous .ilike suffix
// would select the US user first (smallest telegram_id) even when admin named India.
function harness(options = {}) {
  const rows = options.rows || [american, indian]
  const queries = [], updates = [], audits = []
  const supabaseAdmin = {
    from(table) {
      let matchCandidates = null
      let mutation = null
      if (table === 'users') {
        return {
          select(cols) { queries.push(['select', table, cols]); return this },
          in(col, vals) { queries.push(['in', col, vals]); assert.equal(col, 'whatsapp_id'); matchCandidates = vals; return this },
          ilike(col, v) { queries.push(['ilike', col, v]); throw new Error('forbidden suffix lookup') },
          or(expr) { queries.push(['or', expr]); throw new Error('forbidden OR lookup') },
          not(col, op, v) { queries.push(['not', col, op, v]); return this },
          limit(n) {
            queries.push(['limit', n])
            assert.ok(n <= 2)
            if (options.throwRead) throw Error('synthetic read exception')
            const data = options.forceRows || rows.filter(u => matchCandidates && matchCandidates.includes(u.whatsapp_id)).slice(0, n)
            return Promise.resolve({ data: options.nullData ? null : data, error: options.error || null })
          },
          update(fields) { mutation = fields; return this },
          eq(col, val) {
            assert.equal(col, 'id', 'admin mutation is bound to one stored UUID')
            updates.push({ col, val, fields: mutation })
            return Promise.resolve({ error: options.updateError || null })
          },
        }
      }
      if (table === 'memories') {
        return { insert(row) { audits.push(row); return Promise.resolve({ error: null }) } }
      }
      throw Error('Unexpected table ' + table)
    }
  }
  const moduleExports = {}
  const requireStub = path => {
    if (path === '@/lib/supabase-admin') return { supabaseAdmin }
    throw Error('Unexpected import ' + path)
  }
  const original = new Function('require', 'exports', 'process', 'console',
    compiled + '\nreturn {buildAdminPlanChangeReply, buildAdminFindReply, findUserByPhone, isAdminPhone};'
  )(requireStub, moduleExports, { env: { ADMIN_WHATSAPP_NUMBERS: '+919999999999' } }, console)
  return { ...original, queries, updates, audits }
}

async function check(label, fn) { await fn(); console.log('PASS ' + label) }
async function main() {
  await check('local Indian target resolves only complete +91, not foreign same-suffix owner', async () => {
    const h = harness()
    const msg = await h.buildAdminPlanChangeReply('admin upgrade 9876543210 starter')
    assert.match(msg, /User plan updated/)
    assert.match(msg, /\+919876543210/, 'display identifies full country-coded owner')
    assert.equal(h.updates.length, 1)
    assert.equal(h.updates[0].val, indian.id)
    assert.equal(h.updates[0].fields.tier, 'starter')
    assert.equal(h.audits[0].telegram_id, indian.telegram_id)
    assert.equal(h.audits[0].content.includes('"phone":"+919876543210"'), true)
    assert.ok(h.queries.some(q => q[0] === 'in' && !q[2].includes(american.whatsapp_id)))
    assert.ok(!h.queries.some(q => q[0] === 'ilike' || q[0] === 'or'))
  })
  await check('explicit +1 target resolves US owner only', async () => {
    const h = harness()
    const msg = await h.buildAdminPlanChangeReply('admin downgrade +19876543210 free')
    assert.match(msg, /User plan updated/)
    assert.equal(h.updates.length, 1)
    assert.equal(h.updates[0].val, american.id)
  })
  await check('WhatsApp-prefixed full E164 number finds exact matching account', async () => {
    const h = harness()
    const msg = await h.buildAdminFindReply('admin find whatsapp:+19876543210')
    assert.match(msg, /US User/)
    assert.match(msg, /\+19876543210/)
    assert.doesNotMatch(msg, /Indian User/)
    assert.equal(h.updates.length, 0)
  })
  await check('full bare-digit persisted +91 variant remains supported', async () => {
    const h = harness({ rows: [{ ...indian, whatsapp_id: '919876543210' }, american] })
    assert.match(await h.buildAdminPlanChangeReply('admin upgrade +919876543210 pro'), /User plan updated/)
    assert.equal(h.updates[0].val, indian.id)
  })
  await check('invalid, domestic-ambiguous or malformed target cannot reach private query', async () => {
    for (const bad of ['4155550123', '0000000000', '987654321', '98765432100', '+919876543210oops', 'whatsapp:1111111111']) {
      const h = harness()
      const reply = await h.buildAdminPlanChangeReply('admin upgrade ' + bad + ' pro')
      assert.match(reply, /couldn.t find a user/i)
      assert.equal(h.queries.length, 0, bad)
      assert.equal(h.updates.length, 0, bad)
    }
  })
  await check('duplicate exact-owner rows fail closed before any mutation', async () => {
    const h = harness({ rows: [indian, { ...indian, id: 'duplicated-row', whatsapp_id: '+919876543210' }] })
    assert.match(await h.buildAdminPlanChangeReply('admin upgrade 9876543210 pro'), /couldn.t verify.*No plan was changed/i)
    assert.equal(h.updates.length, 0)
    assert.equal(h.audits.length, 0)
  })
  await check('database error, thrown read and null result fail closed', async () => {
    for (const options of [{ error: { code:'synthetic' } }, { throwRead: true }, { nullData: true }]) {
      const h = harness(options)
      assert.match(await h.buildAdminPlanChangeReply('admin upgrade 9876543210 pro'), /couldn.t verify.*No plan was changed/i)
      assert.equal(h.updates.length, 0)
    }
  })
  await check('unexpected owner row from mock query fails identity recheck', async () => {
    const h = harness({ forceRows: [american] })
    assert.match(await h.buildAdminPlanChangeReply('admin upgrade 9876543210 pro'), /No plan was changed/i)
    assert.equal(h.updates.length, 0)
  })
  await check('missing stable target identifier fails closed', async () => {
    for (const u of [{ ...indian, id: null }, { ...indian, telegram_id: null }]) {
      const h = harness({ rows: [u] })
      assert.match(await h.buildAdminPlanChangeReply('admin upgrade 9876543210 pro'), /No plan was changed/i)
      assert.equal(h.updates.length, 0)
    }
  })
  await check('update failure never claims plan changed', async () => {
    const h = harness({ updateError: { message: 'synthetic unavailable' } })
    assert.match(await h.buildAdminPlanChangeReply('admin upgrade 9876543210 pro'), /Plan update failed/i)
    assert.equal(h.audits.length, 0)
  })
  console.log('admin WhatsApp original-module two-owner precision: 10 case classes PASSED')
}
main().catch(err => { console.error(err); process.exitCode = 1 })
