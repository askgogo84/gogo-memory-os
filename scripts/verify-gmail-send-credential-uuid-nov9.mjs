// Port of #1228 onto main: the Gmail token-bearing users row must be bound to the actor's user UUID
// as well as the owner, and the returned row must echo both before any token is decrypted/refreshed.
// Main's affirmative consent gate (#1255, gmailConsentState) is kept as-is and exercised here.
// Sealed original-source fixture: fictional rows, no network, Gmail, sends or provider side effects.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const ts = require('typescript')

const path = 'lib/agent/gmail-send.ts'
const source = fs.readFileSync(path, 'utf8')
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'gmailAccess')
assert.ok(fn, 'must test the original Gmail credential entrypoint')
const js = ts.transpileModule(fn.getText(ast).replace(/^export\s+/, '') + '\nmodule.exports={gmailAccess};',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

const OWNER = 123456789, UUID = 'fictional-gmail-owner-uuid'
let state
function reset() {
  state = { consent: 'on', user: { id: UUID, telegram_id: OWNER, gmail_connected: true, gmail_send_connected: true,
    gmail_email: 'alice@example.test', gmail_access_token: 'fixture-access', gmail_refresh_token: '' },
  queries: [], consentCalls: [], decryptions: 0, refreshes: 0 }
}
const db = { from(table) {
  assert.equal(table, 'users', 'gmailAccess reads only the users row directly (consent goes through gmailConsentState)')
  const q = { fields: '', filters: [],
    select(f) { q.fields = f; return q },
    eq(k, v) { q.filters.push([k, v]); return q },
    async maybeSingle() { state.queries.push({ fields: q.fields, filters: [...q.filters] }); return { data: state.user, error: null } } }
  return q
} }
const module = { exports: {} }
vm.runInNewContext(js, { module, exports: module.exports, supabaseAdmin: db, Promise, String,
  require: id => {
    if (id === './gmail-consent') return { gmailConsentState: async owner => { state.consentCalls.push(owner); return state.consent } }
    throw new Error('Unapproved dependency: ' + id)
  },
  decryptGoogleToken(v) { state.decryptions++; return String(v || '') },
  async refreshGmailAccessToken() { state.refreshes++; return 'fixture-refreshed' },
}, { timeout: 2500, filename: path })
const gmailAccess = module.exports.gmailAccess
const actor = (userId = UUID, owner = OWNER) => ({ legacyTelegramId: owner, userId, name: 'Fictional', whatsappId: 'whatsapp:+15550000000' })
let n = 0
async function check(name, f) { reset(); await f(); n++; console.log('PASS ' + name) }

await check('owner + UUID bound credential row yields the fixture token', async () => {
  const out = await gmailAccess(actor(), { requireSend: true })
  assert.equal(out.ok, true); assert.equal(out.accessToken, 'fixture-access')
  const [q] = state.queries
  assert.match(q.fields, /\bid,telegram_id,/, 'returned row must carry id and telegram_id for the echo check')
  assert.deepEqual(q.filters, [['telegram_id', OWNER], ['id', UUID]], 'credential row bound to owner AND actor UUID')
  assert.deepEqual(state.consentCalls, [OWNER], "main's affirmative consent gate still runs")
})
await check('returned row for another user UUID never decrypts Gmail', async () => {
  state.user.id = 'other-account-uuid'
  const out = await gmailAccess(actor())
  assert.equal(out.ok, false); assert.equal(out.reason, 'gmail_owner_invalid')
  assert.equal(state.decryptions, 0); assert.equal(state.refreshes, 0); assert.equal(state.consentCalls.length, 0)
})
await check('returned row for another telegram owner never decrypts Gmail', async () => {
  state.user.telegram_id = OWNER + 1
  const out = await gmailAccess(actor())
  assert.equal(out.ok, false); assert.equal(out.reason, 'gmail_owner_invalid'); assert.equal(state.decryptions, 0)
})
await check('a NULL echoed id/owner is not proof of ownership', async () => {
  state.user.id = null
  assert.equal((await gmailAccess(actor())).reason, 'gmail_owner_invalid')
  reset(); state.user.telegram_id = null
  assert.equal((await gmailAccess(actor())).reason, 'gmail_owner_invalid'); assert.equal(state.decryptions, 0)
})
await check('actor without a user UUID cannot use a row that names one', async () => {
  const out = await gmailAccess(actor(''))
  assert.equal(out.ok, false); assert.equal(out.reason, 'gmail_owner_invalid'); assert.equal(state.decryptions, 0)
})
await check("main's consent gate still blocks a missing/off consent before decryption", async () => {
  for (const c of ['missing', 'off']) {
    reset(); state.consent = c
    const out = await gmailAccess(actor())
    assert.equal(out.ok, false); assert.equal(out.reason, 'gmail_consent_missing'); assert.equal(state.decryptions, 0)
  }
})
assert.match(source, /export async function executeApprovedGmailSend[\s\S]*?gmailAccess\(params\.actor,\{requireSend:true\}\)/,
  'approved send must recheck the bound credential immediately before the provider send')
console.log(`Gmail send credential UUID binding: ${n} checks PASS (sealed original source, no provider calls)`)
