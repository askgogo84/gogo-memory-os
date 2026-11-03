// Synthetic, sealed original-TypeScript-source Gmail consent and owner isolation suite.
// All Gmail, Composio, forwarding, identity and database records are fictional;
// absolutely no provider, database, network, account or message actions.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const SOURCE = readFileSync('lib/email/attention-store.ts', 'utf8')
const transpiled = ts.transpileModule(SOURCE, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const results = { controls: 0, mandatory: 0, failures: [] }
async function check(name, fn, mandatory = true) {
  try {
    await fn()
    results[mandatory ? 'mandatory' : 'controls']++
    console.log('PASS ' + (mandatory ? 'MANDATORY' : 'CONTROL') + ': ' + name)
  } catch (error) {
    results.failures.push({ name, error: String(error?.message || error) })
    console.error('FAIL: ' + name + ' — ' + String(error?.message || error))
  }
}

function fixture(options = {}) {
  const owner = options.owner ?? 42
  const state = {
    db: [], composio: 0, gmail: 0, decrypted: 0, refresh: 0,
    errors: [], logs: [], owner, options,
  }
  const fakeData = {
    users: {
      telegram_id: options.userOwner === undefined ? owner : options.userOwner,
      gmail_connected: options.connected === undefined ? false : options.connected,
      gmail_email: 'owner@example.invalid',
      gmail_refresh_token: null,
      gmail_access_token: options.accessToken === undefined ? null : options.accessToken,
    },
    user_consent_settings: options.consent === null ? null : {
      telegram_id: options.consentOwner === undefined ? owner : options.consentOwner,
      gmail_enabled: options.consent === undefined ? true : options.consent,
    },
    email_aliases: options.alias === undefined ? null : { alias: options.alias },
    inbound_emails: options.forwarded || [],
    email_attention_rules: [],
  }
  const db = {
    from(table) {
      assert.ok(Object.prototype.hasOwnProperty.call(fakeData, table), 'unexpected table ' + table)
      const call = { table, selected: '', filters: [] }
      state.db.push(call)
      const query = {
        select(columns) { call.selected = columns; return query },
        eq(key, value) { call.filters.push(['eq', key, value]); return query },
        gte(key, value) { call.filters.push(['gte', key, value]); return query },
        order() { return query },
        limit() { return query },
        maybeSingle() {
          if (options.throwTable === table) return Promise.reject(new Error('fictional provider unavailable'))
          return Promise.resolve({
            data: options.errorTable === table ? null : fakeData[table],
            error: options.errorTable === table ? { message: 'fictional private DB error' } : null,
          })
        },
        then(resolve, reject) {
          return Promise.resolve({
            data: options.errorTable === table ? null : fakeData[table],
            error: options.errorTable === table ? { message: 'fictional private DB error' } : null,
          }).then(resolve, reject)
        },
      }
      return query
    },
  }
  const attention = {
    senderEmailOf: from => String(from).match(/[\w.-]+@[\w.-]+/)?.[0] || '',
    senderDomainOf: from => String(from).split('@')[1] || '',
    senderNameOf: from => String(from).split('<')[0],
    pickAttention: emails => ({ checked: emails.length, picked: [] }),
    formatAttentionCard: () => 'fixture',
    ruleFromFeedback: () => ({ kind: 'always', matchType: 'sender', matchValue: 'fixture@example.invalid', label: 'fixture', source: 'chat' }),
    scoreEmail: () => ({ category: 'person', senderEmail: 'fixture@example.invalid', senderName: 'Fixture' }),
  }
  const modules = {
    '@anthropic-ai/sdk': { default: class AnthropicStub {} },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/security/google-token-crypto': {
      decryptGoogleToken: value => { state.decrypted++; return value ? String(value) : '' },
    },
    '@/lib/services/google-gmail': {
      refreshGmailAccessToken: async () => { state.refresh++; return null },
      fetchGmailAttentionThreads: async () => {
        state.gmail++
        return [{ id: 'fictional-native-thread', messages: [{
          id: 'native-1', messageId: 'native-1', from: 'Person <native@example.invalid>',
          to: 'owner@example.invalid', subject: 'Fictional native Gmail', snippet: 'Synthetic',
        }] }]
      },
    },
    '@/lib/connectors/composio-gmail': {
      fetchComposioRecentEmails: async id => {
        state.composio++
        state.composioOwner = id
        return { ownEmail: 'owner@example.invalid', repliedSenders: new Set(),
          emails: [{ id: 'composio-1', messageId: 'composio-1', from: 'Person <composio@example.invalid>',
            to: 'owner@example.invalid', subject: 'Fictional Composio mail', snippet: 'Synthetic', source: 'composio' }] }
      },
    },
    './attention': attention,
    './attention-commands': {
      parseAttentionCommand: text => /emails that need|show emails/.test(String(text)) ? { type: 'show' } : null,
      isUndo: () => false,
    },
  }
  const exportsObj = {}
  runInNewContext(transpiled, {
    exports: exportsObj,
    require(name) {
      assert.ok(Object.prototype.hasOwnProperty.call(modules, name), 'unexpected import: ' + name)
      return modules[name]
    },
    process: { env: {} },
    Date, Number, Promise, Set, console: { error: value => state.logs.push(String(value)) },
  }, { filename: 'sealed-email-attention-original-source.js', timeout: 3000 })
  return { ...exportsObj, state }
}

function assertNoProviderCalls(f) {
  assert.equal(f.state.gmail, 0, 'native Gmail must not be called')
  assert.equal(f.state.composio, 0, 'Composio Gmail must not be called')
  assert.equal(f.state.refresh, 0, 'refresh must not be called')
  assert.equal(f.state.decrypted, 0, 'stored Gmail tokens must not be decrypted')
}
function assertAllDbOwnerBound(f, owner) {
  for (const call of f.state.db.filter(x => ['users', 'user_consent_settings', 'email_aliases', 'inbound_emails'].includes(x.table))) {
    const bound = call.filters.find(x => x[0] === 'eq' && x[1] === 'telegram_id')
    assert.ok(bound, 'missing exact owner filter on ' + call.table)
    assert.equal(String(bound[2]), String(owner), 'wrong owner on ' + call.table)
  }
}

await check('existing opt-in native Gmail can still read its own synthetic messages', async () => {
  const f = fixture({ connected: true, accessToken: 'fictional-native-token', consent: true })
  const data = await f.readAttentionSources(42)
  assert.equal(data.connected, true)
  assert.equal(data.emails.length, 1)
  assert.equal(data.sources[0], 'gmail')
  assert.equal(f.state.gmail, 1)
  assert.equal(f.state.composio, 0)
  assertAllDbOwnerBound(f, 42)
}, false)

await check('explicitly opted-in Composio-only Gmail remains available', async () => {
  const f = fixture({ connected: false, consent: true })
  const data = await f.readAttentionSources(42)
  assert.equal(data.connected, true)
  assert.equal(data.sources[0], 'composio')
  assert.equal(data.emails[0].source, 'composio')
  assert.equal(f.state.composio, 1)
  assert.equal(f.state.composioOwner, 42)
  assert.equal(f.state.gmail, 0)
  assertAllDbOwnerBound(f, 42)
}, false)

await check('safe negative WhatsApp owner retains separately approved Composio read', async () => {
  const owner = -2251799813685253
  const f = fixture({ owner, connected: false, consent: true })
  const data = await f.readAttentionSources(owner)
  assert.equal(data.connected, true)
  assert.equal(f.state.composioOwner, owner)
  assertAllDbOwnerBound(f, owner)
}, false)

await check('Gmail disabled still allows separately configured forwarded inbox', async () => {
  const f = fixture({ consent: false, alias: 'fictional-alias', forwarded: [{
    id: 'forwarded-1', message_id: 'fictional-forwarded-id', thread_key: 'forwarded-thread',
    from_addr: 'Forwarder <forward@example.invalid>', to_addr: 'fictional-alias@example.invalid',
    subject: 'Synthetic forwarded-only mail', snippet: 'Fictional', received_at: '2026-11-01T00:00:00.000Z',
  }] })
  const data = await f.readAttentionSources(42)
  assert.equal(data.connected, true)
  assert.equal(data.sources.join(','), 'forwarded')
  assert.equal(data.emails[0].subject, 'Synthetic forwarded-only mail')
  assertNoProviderCalls(f)
}, false)

await check('explicit gmail_enabled=false blocks native and Composio even if native token exists', async () => {
  const f = fixture({ consent: false, connected: true, accessToken: 'fictional-native-token' })
  const data = await f.readAttentionSources(42)
  assert.equal(data.connected, false)
  assertNoProviderCalls(f)
})
await check('missing Gmail consent is not an implicit native or Composio permission', async () => {
  const f = fixture({ consent: null, connected: true, accessToken: 'fictional-native-token' })
  const data = await f.readAttentionSources(42)
  assert.equal(data.connected, false)
  assertNoProviderCalls(f)
})
await check('consent DB error fails closed for both Gmail transports', async () => {
  const f = fixture({ errorTable: 'user_consent_settings', connected: true, accessToken: 'fictional-native-token' })
  const data = await f.readAttentionSources(42)
  assert.equal(data.connected, false)
  assertNoProviderCalls(f)
})
await check('consent DB thrown exception fails closed for both Gmail transports', async () => {
  const f = fixture({ throwTable: 'user_consent_settings', connected: true, accessToken: 'fictional-native-token' })
  const data = await f.readAttentionSources(42)
  assert.equal(data.connected, false)
  assertNoProviderCalls(f)
})
await check('consent echo with a different owner cannot grant this account Gmail access', async () => {
  const f = fixture({ consentOwner: 43, consent: true, connected: true, accessToken: 'fictional-token' })
  const data = await f.readAttentionSources(42)
  assert.equal(data.connected, false)
  assertNoProviderCalls(f)
})
await check('users owner echo mismatch blocks native and Composio access', async () => {
  const f = fixture({ userOwner: 43, consent: true, connected: true, accessToken: 'fictional-token' })
  const data = await f.readAttentionSources(42)
  assert.equal(data.connected, false)
  assertNoProviderCalls(f)
})
await check('users lookup error denies both Gmail provider transports', async () => {
  const f = fixture({ errorTable: 'users', connected: true, accessToken: 'fictional-token' })
  const data = await f.readAttentionSources(42)
  assert.equal(data.connected, false)
  assertNoProviderCalls(f)
})
await check('distinct safe owners may read only their owner-bound consent', async () => {
  const f = fixture({ owner: 43, consent: true })
  const data = await f.readAttentionSources(43)
  assert.equal(data.sources.join(','), 'composio')
  assert.equal(f.state.composioOwner, 43)
  assertAllDbOwnerBound(f, 43)
})
await check('unsafe rounded ID refuses all reads before any privileged query', async () => {
  const f = fixture()
  await assert.rejects(() => f.readAttentionSources(9007199254740992), /email_attention_owner_invalid/)
  assert.equal(f.state.db.length, 0)
  assertNoProviderCalls(f)
})
await check('unsafe big int owner cannot be used for rules, saving or card', async () => {
  const f = fixture()
  const invalid = 9007199254740992
  await assert.rejects(() => f.loadRules(invalid), /email_attention_owner_invalid/)
  await assert.rejects(() => f.saveRule(invalid, { kind: 'always' }), /email_attention_owner_invalid/)
  await assert.rejects(() => f.buildAttentionCard({ legacyTelegramId: invalid, timezone: 'Asia/Kolkata' }, { polish: null }), /email_attention_owner_invalid/)
  assert.equal(f.state.db.length, 0)
})
await check('unsafe owner command stops before loading private rules or email events', async () => {
  const f = fixture()
  await assert.rejects(() => f.handleEmailAttentionCommand({
    actor: { legacyTelegramId: 9007199254740992 }, text: 'show emails',
  }), /email_attention_owner_invalid/)
  assert.equal(f.state.db.length, 0)
  assertNoProviderCalls(f)
})
await check('negative owner with disabled consent does not bypass through Composio', async () => {
  const owner = -2251799813685253
  const f = fixture({ owner, consent: false })
  const data = await f.readAttentionSources(owner)
  assert.equal(data.connected, false)
  assertNoProviderCalls(f)
  assertAllDbOwnerBound(f, owner)
})

console.log('EMAIL_ATTENTION_PROVIDER_CONSENT_FIX ' + JSON.stringify({
  controls: results.controls, mandatory: results.mandatory,
  failed: results.failures.length, synthetic: true,
}))
if (results.failures.length) process.exitCode = 1
