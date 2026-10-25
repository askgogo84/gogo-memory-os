// Inert regression against the ACTUAL transpiled legacy GOGO-<digits> referral handler.
// No network, provider, user account, memory write or referral reward leaves this VM.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const state: any = { users: [], memories: [], writes: [], reads: [], failUsers: false, failMemories: false }
function reset(users: any[] = [], opts: any = {}) {
  state.users = users
  state.memories = opts.memories || []
  state.writes = []
  state.reads = []
  state.failUsers = !!opts.failUsers
  state.failMemories = !!opts.failMemories
}
const supabaseAdmin = {
  from(table) {
    assert.ok(table === 'users' || table === 'memories', 'unexpected table: ' + table)
    state.reads.push({ table })
    const filters = []
    let count = 100
    let page: [number, number] | null = null
    let ordered = false
    const query = {
      select() { return query },
      ilike(field, like) {
        assert.equal(table, 'users')
        assert.equal(field, 'whatsapp_id')
        assert.match(like, /^%[0-9]+%$/)
        const suffix = like.slice(1, -1)
        filters.push(row => String(row.whatsapp_id || '').includes(suffix))
        return query
      },
      not(field, op, value) {
        assert.equal(op, 'is')
        assert.equal(value, null)
        filters.push(row => row[field] !== null && row[field] !== undefined)
        return query
      },
      eq(field, value) { filters.push(row => String(row[field]) === String(value)); return query },
      like(field, like) {
        assert.equal(field, 'content')
        assert.ok(like.endsWith('%'))
        filters.push(row => String(row[field]).startsWith(like.slice(0, -1)))
        return query
      },
      limit(n) { count = n; return query },
      order(field, options) {
        assert.equal(table, 'users')
        assert.equal(field, 'telegram_id')
        assert.equal(options?.ascending, true)
        ordered = true
        return query
      },
      range(start, end) {
        assert.equal(table, 'users')
        assert.equal(ordered, true, 'stable sorted pagination is mandatory')
        assert.ok(Number.isInteger(start) && start >= 0 && end >= start)
        assert.ok(end - start + 1 <= 500, 'page remains bounded')
        page = [start, end]
        return query
      },
      insert(row) {
        assert.equal(table, 'memories')
        state.writes.push({ table, ...row })
        return Promise.resolve({ error: null })
      },
      then(resolve, reject) {
        const failed = table === 'users' ? state.failUsers : state.failMemories
        return Promise.resolve(failed
          ? { data: null, error: { message: 'synthetic DB read failure' } }
          : { data: (() => {
              const rows = (table === 'users' ? state.users : state.memories)
                .filter(row => filters.every(test => test(row)))
              if (table === 'users' && ordered) rows.sort((a, b) => {
                const x = BigInt(String(a.telegram_id)); const y = BigInt(String(b.telegram_id))
                return x < y ? -1 : x > y ? 1 : 0
              })
              return page ? rows.slice(page[0], page[1] + 1) : rows.slice(0, count)
            })(), error: null }
        ).then(resolve, reject)
      },
    }
    return query
  },
}
const source = readFileSync(new URL('../lib/bot/handlers/referral-unlock.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const moduleExports: Record<string, any> = {}
runInNewContext(compiled, {
  exports: moduleExports,
  require(id) {
    if (id === '@/lib/supabase-admin') return { supabaseAdmin }
    if (id === '@/lib/product-urls') return { waLink: () => 'https://wa.me/0000000000' }
    throw new Error('unexpected imported dependency: ' + id)
  },
  process: { env: {} },
  Number, String, Object, Array, JSON, Date, Promise,
  console: { log() {}, error() {}, warn() {} },
  fetch() { throw new Error('real network forbidden') },
}, { filename: 'lib/bot/handlers/referral-unlock.ts', timeout: 1500 })
assert.equal(typeof moduleExports.recordReferralJoinFromText, 'function', 'real compiled referral handler executes')
assert.equal(typeof moduleExports.buildReferralUnlockReply, 'function', 'real compiled referral exports loaded')

const code = 'GOGO-4155552671'
const id = -4155552671
const referred = -2222222222
const good = (telegram_id: number | string = id, whatsapp_id = '+914155552671') => ({ telegram_id, whatsapp_id })
const wrong = (telegram_id = -987654321, whatsapp_id = '+14155552671') => ({ telegram_id, whatsapp_id })
const params = (value = code, options: any = {}) => ({
  text: 'Hi AskGogo ' + value, referredTelegramId: referred,
  referredExternalId: options.externalId || 'synthetic-joined-account',
  referredName: 'Synthetic Invitee', ...options,
})
let count = 0
async function check(name, fn) {
  reset()
  await fn()
  ++count
  console.log('PASS exact referral owner isolation: ' + name)
}

await check('legitimate inviter is selected by own persisted telegram ID, not the first foreign suffix', async () => {
  state.users = [wrong(), good()]
  const answer = await moduleExports.recordReferralJoinFromText(params())
  assert.equal(answer?.saved, true)
  assert.equal(state.writes.length, 2)
  assert.equal(state.writes[0].telegram_id, id, 'only real code owner credited')
  assert.equal(state.writes[1].telegram_id, referred, 'referred account is unchanged')
  assert.ok(!state.writes.some(row => row.telegram_id === wrong().telegram_id))
})
await check('foreign WhatsApp suffix alone cannot claim a different inviter code', async () => {
  state.users = [wrong()]
  assert.equal(await moduleExports.recordReferralJoinFromText(params()), null)
  assert.equal(state.writes.length, 0)
})
await check('two canonical owners whose telegram IDs produce the same code are ambiguous', async () => {
  state.users = [good(), good(4155552671, '+14155552671')]
  assert.equal(await moduleExports.recordReferralJoinFromText(params()), null)
  assert.equal(state.writes.length, 0)
})
await check('colliding generated codes are rejected even when only one WhatsApp phone matched the old suffix query', async () => {
  state.users = [
    { telegram_id: 884501501, whatsapp_id: '+14155552671' },
    { telegram_id: -884501501, whatsapp_id: 'whatsapp:+919884501501' },
  ]
  assert.equal(await moduleExports.recordReferralJoinFromText(params('GOGO-884501501')), null)
  assert.equal(state.writes.length, 0, 'no owner receives credit on an ambiguous public code')
})
await check('longer canonical owner IDs sharing the last ten digits also block credit', async () => {
  state.users = [
    good(4155552671, '+914155552671'),
    good(14155552671, '+14155552671'),
  ]
  assert.equal(await moduleExports.recordReferralJoinFromText(params()), null)
  assert.equal(state.writes.length, 0)
})
await check('unsafe 64-bit saved telegram ID never aliases a referral recipient', async () => {
  state.users = [good('9007199254740993', 'whatsapp:+9199254740993')]
  assert.equal(await moduleExports.recordReferralJoinFromText(params('GOGO-9254740993')), null)
  assert.equal(state.writes.length, 0)
})
await check('DB outage fails closed without any memory write', async () => {
  state.users = [good()]
  state.failUsers = true
  assert.equal(await moduleExports.recordReferralJoinFromText(params()), null)
  assert.equal(state.writes.length, 0)
})
await check('candidate truncation is not interpreted as a unique verified inviter', async () => {
  state.users = [good(), ...Array.from({ length: 5000 }, (_, i) => wrong(-(i + 40), '+14155552671'))]
  assert.equal(await moduleExports.recordReferralJoinFromText(params()), null)
  assert.equal(state.writes.length, 0)
})
await check('unknown memory dedupe state fails closed before writes', async () => {
  state.users = [good()]
  state.failMemories = true
  const reply = await moduleExports.recordReferralJoinFromText(params())
  assert.equal(reply?.reason, 'lookup_unavailable')
  assert.equal(state.writes.length, 0)
})
await check('already-recorded join stays idempotent', async () => {
  state.users = [good()]
  state.memories = [{ id: 1, telegram_id: id,
    content: 'ASKGOGO_REFERRAL_JOINED:' + code + ':synthetic-joined-account' }]
  const reply = await moduleExports.recordReferralJoinFromText(params())
  assert.equal(reply?.reason, 'already_recorded')
  assert.equal(state.writes.length, 0)
})
await check('referred actor with unsafe Number cannot create either memory', async () => {
  state.users = [good()]
  const reply = await moduleExports.recordReferralJoinFromText(params(code, { referredTelegramId: Number.MAX_SAFE_INTEGER + 100 }))
  assert.equal(reply?.reason, 'invalid_referred_owner')
  assert.equal(state.writes.length, 0)
  assert.equal(state.reads.length, 0)
})
await check('self-referral remains rejected', async () => {
  state.users = [good()]
  const reply = await moduleExports.recordReferralJoinFromText(params(code, { referredTelegramId: id }))
  assert.equal(reply?.reason, 'self_referral')
  assert.equal(state.writes.length, 0)
})
await check('legacy negative nine-digit generated inviter code remains functional', async () => {
  state.users = [{ telegram_id: -884501501, whatsapp_id: 'whatsapp:+919884501501' }]
  const reply = await moduleExports.recordReferralJoinFromText(params('GOGO-884501501'))
  assert.equal(reply?.saved, true)
  assert.equal(state.writes[0].telegram_id, -884501501)
})
await check('inert input lacking referral code causes no lookup and no writes', async () => {
  state.users = [good()]
  assert.equal(await moduleExports.recordReferralJoinFromText(params('not-a-referral-code')), null)
  assert.equal(state.reads.length, 0)
  assert.equal(state.writes.length, 0)
})
console.log('referral owner isolation: ' + count + ' inert actual-handler regressions PASS; zero external calls')
