// TEST ONLY / EXPECTED SAFETY RED: admin waitlist approvals require durable proof
// before any "you're in" WhatsApp notice or completed-approval receipt.
// Execute the ACTUAL unchanged lib/admin/actions.ts inside a sealed, synthetic VM.
// No real admin, user, account, database, WhatsApp, network, credential or send.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const FILE = 'lib/admin/actions.ts'
const original = readFileSync(FILE, 'utf8')
assert.match(original, /export async function runAdminAction\(/, 'execute the real admin action module')
assert.match(original, /case 'waitlist\.approve'/, 'exercise the shipped waitlist approval branch')

const built = ts.transpileModule(original, {
  fileName: FILE,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
})
const errors = (built.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error)
assert.equal(errors.length, 0, 'actual shipped module must transpile')

function fixture(options = {}) {
  const opt = options
  const events = []
  const waitRows = (opt.waitRows || [{
    id: 'synthetic-invite-1', phone_e164: '+15550000001',
    status: 'waiting', profile_name: 'Synthetic User',
  }]).map(r => ({ ...r }))
  const userRows = (opt.userRows || [{
    whatsapp_id: 'whatsapp:+15550000001', access_status: 'blocked',
  }]).map(r => ({ ...r }))
  const record = (kind, more = {}) => events.push({ kind, ...more })
  const db = {
    from(table) {
      assert.ok(table === 'users' || table === 'waitlist',
        'UNEXPECTED DB table access: ' + String(table))
      return {
        select(_columns) {
          assert.equal(table, 'waitlist', 'no private user reads in waitlist approval fixture')
          return {
            async in(column, values) {
              assert.equal(column, 'id')
              record('select', { ids: [...values] })
              if (opt.selectError) return { data: null, error: { message: 'synthetic selection error' } }
              return { data: waitRows.filter(r => values.includes(r.id)).map(r => ({ ...r })), error: null }
            },
          }
        },
        update(patch) {
          assert.ok(patch && typeof patch === 'object', 'update must include explicit data')
          return {
            async eq(column, value) {
              assert.equal(table, 'waitlist')
              assert.equal(column, 'id')
              record('waitlist_update_attempt', { id: value })
              if (opt.failWaitlistWrite) return { data: null, error: { code: 'synthetic_failure', message: 'waitlist write rejected' } }
              for (const row of waitRows.filter(r => r.id === value)) Object.assign(row, patch)
              record('waitlist_update_committed', { id: value })
              return { data: null, error: null }
            },
            async in(column, values) {
              assert.equal(table, 'users')
              assert.equal(column, 'whatsapp_id')
              record('user_unblock_attempt', { phones: [...values] })
              if (opt.failUserWrite) return { data: null, error: { code: 'synthetic_failure', message: 'user unblock rejected' } }
              for (const row of userRows.filter(r => values.includes(r.whatsapp_id))) Object.assign(row, patch)
              record('user_unblock_committed')
              return { data: null, error: null }
            },
          }
        },
      }
    },
  }
  const mocks = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/whatsapp': {
      async sendWhatsAppAccessGranted(phone) {
        record('send', { phone })
        return opt.sendResult || 'sent via template'
      },
    },
    '@/lib/bot/handlers/welcome': {
      ACCESS_GRANTED_TEMPLATE_BODY: 'inert template',
      buildAccessGrantedText: name => 'Welcome ' + String(name || ''),
      welcomeFirstName: name => String(name || 'friend'),
    },
    './console-auth': {
      audit: async (_admin, action) => { record('audit', { action }); return null },
      canDo: (role, required) => role === 'owner' || (role === 'operator' && required === 'operator'),
      e164: value => String(value || '').replace(/^whatsapp:/, ''),
      hashPassword: () => 'inert',
      setPasswordHash: async () => { throw Error('BLOCKED auth mutation') },
    },
  }
  const exports = {}
  runInNewContext(built.outputText, {
    exports,
    require(name) {
      if (Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
      throw Error('BLOCKED unexpected import: ' + name)
    },
    console,
    Date,
    Promise,
    Number,
    String,
    Object,
    JSON,
    process: { env: {} },
    fetch() { throw Error('BLOCKED network fetch') },
  }, { filename: FILE, timeout: 2500 })
  assert.equal(typeof exports.runAdminAction, 'function',
    'must execute shipped runAdminAction, not a reimplementation')
  const run = (role = 'operator', body = { ids: ['synthetic-invite-1'] }) =>
    exports.runAdminAction({ role, phone: '+15559990000' }, 'waitlist.approve', body)
  return { run, events, waitRows, userRows }
}

let controls = 0
let safetyPass = 0
let safetyFail = 0
async function control(name, test) {
  await test()
  controls++
  console.log('PASS CONTROL: ' + name)
}
async function safety(name, test) {
  try {
    await test()
    safetyPass++
    console.log('PASS SAFETY: ' + name)
  } catch (error) {
    safetyFail++
    console.error('FAIL SAFETY (expected until corrected): ' + name + ': ' +
      String(error && error.message || error))
  }
}

// Positive controls demonstrate that the mocked approval path is functional.
await control('operator completes one genuinely persisted approval and sends once', async () => {
  const h = fixture()
  const result = await h.run()
  assert.equal(result.ok, true)
  assert.equal(h.waitRows[0].status, 'invited')
  assert.equal(h.userRows[0].access_status, 'active')
  assert.equal(h.events.filter(e => e.kind === 'send').length, 1)
  assert.equal(h.events.filter(e => e.kind === 'audit').length, 1)
})
await control('viewer cannot approve or send any welcome', async () => {
  const h = fixture()
  const result = await h.run('viewer')
  assert.equal(result.ok, false)
  assert.equal(h.events.length, 0)
})
await control('empty selection is denied without mutation or send', async () => {
  const h = fixture()
  const result = await h.run('operator', { ids: [] })
  assert.equal(result.ok, false)
  assert.equal(h.events.length, 0)
})
await control('provider failure is not represented as successful WhatsApp delivery', async () => {
  const h = fixture({ sendResult: 'not sent: synthetic provider outage' })
  const result = await h.run()
  assert.equal(result.ok, true, 'persisted approval can be distinct from failed notification')
  assert.match(String(result.message), /could not be sent/)
  assert.equal(h.waitRows[0].status, 'invited')
  assert.equal(h.userRows[0].access_status, 'active')
})

// Safety expectations that must be GREEN before approving an outbound "you are in".
await safety('P1: rejected waitlist write must not trigger welcome before authorization', async () => {
  const h = fixture({ failWaitlistWrite: true })
  await h.run()
  assert.equal(h.events.filter(e => e.kind === 'send').length, 0,
    'sent approved-welcome although waitlist row stayed waiting')
})
await safety('P1: rejected waitlist write must not claim approval completed', async () => {
  const h = fixture({ failWaitlistWrite: true })
  const result = await h.run()
  assert.equal(result.ok, false,
    'returned ok:true despite waitlist write error')
})
await safety('P1: blocked user must not receive welcome when unblock write is rejected', async () => {
  const h = fixture({ failUserWrite: true })
  await h.run()
  assert.equal(h.userRows[0].access_status, 'blocked',
    'fixture must retain blocked user after returned DB error')
  assert.equal(h.events.filter(e => e.kind === 'send').length, 0,
    'sent welcome while target user remained blocked')
})
await safety('P1: failed unblock must not produce a completed-approval receipt', async () => {
  const h = fixture({ failUserWrite: true })
  const result = await h.run()
  assert.equal(result.ok, false,
    'reported Approved while the user unblock failed')
})
await safety('P2: missing requested waitlist ID must not be counted as approved', async () => {
  const h = fixture({ waitRows: [] })
  const result = await h.run()
  assert.equal(result.ok, false, 'reported Approved 1 when no row was selected')
})
await safety('P1: failed authorization writes must not be audited as completed approval', async () => {
  const h = fixture({ failWaitlistWrite: true })
  await h.run()
  assert.equal(h.events.filter(e => e.kind === 'audit').length, 0,
    'audited Approved despite a returned database write error')
})

console.log('RESULT controls=' + controls + ' safety_pass=' + safetyPass +
  ' safety_fail=' + safetyFail)
assert.equal(controls, 4, 'all four safe-path controls must execute')
assert.equal(safetyPass, 6, 'all six durable-approval / send-truth safety assertions are release gates')
console.log('SECURITY GREEN: durable approval precedes welcome send and completion receipt')
