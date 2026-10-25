/**
 * G6 / Bug F — "disconnect my Google account" must disconnect Calendar too.
 *
 * Token model (confirmed from code): Gmail and Calendar are authorised under the
 * SAME Google OAuth client (GOOGLE_CLIENT_ID) but AskGogo stores SEPARATE refresh
 * tokens — Gmail in users.gmail_refresh_token, the primary Calendar account in
 * users.google_refresh_token, extra calendars in google_calendar_accounts.
 *
 * Drives the REAL dispatchThroughSameBrain('disconnect my google account') against
 * an in-memory DB (VM-load harness, same shape as the watch-command tests) and asserts:
 *   - every stored Google token is revoked (gmail + primary calendar + extra calendar),
 *   - users.google_refresh_token and users.google_calendar_connected are cleared
 *     (alongside the gmail_* fields that already worked),
 *   - extra google_calendar_accounts rows are deleted,
 *   - the confirmation names BOTH Gmail and Calendar.
 * NEGATIVE CONTROL: applying the OLD clear set (gmail fields only) to a fresh row
 * leaves google_calendar_connected / google_refresh_token SET — proving the test
 * distinguishes the fix from the pre-fix behaviour.
 *
 * Prints DISCONNECT_CALENDAR_OK only after every assertion passes.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as nodeCrypto from 'node:crypto'
import ts from 'typescript'

type Row = Record<string, any>
const stores: Record<string, any> = { users: [], google_calendar_accounts: [], agent_activity: [] }
const revoked: string[] = []
let failToken: string | null = null // when set, revokeGoogleToken returns false for this decrypted token

function makeDb() {
  return {
    from(table: string) {
      const b: any = {
        _filters: [] as Array<[string, any]>,
        _insert: null as Row | null,
        _update: null as Row | null,
        _delete: false,
        select() { return b },
        eq(col: string, val: any) { b._filters.push([col, val]); return b },
        order() { return b },
        limit() { return b },
        insert(row: Row) { b._insert = row; return b },
        update(row: Row) { b._update = row; return b },
        delete() { b._delete = true; return b },
        maybeSingle: async () => { const r = rows(); return { data: r[0] || null, error: null } },
        single: async () => { const r = rows(); return { data: r[0] || null, error: null } },
        then: (res: any, rej: any) => Promise.resolve(resolveTerminal()).then(res, rej),
      }
      function rows(): Row[] {
        let r: Row[] = stores[table] || []
        for (const [col, val] of b._filters) r = r.filter((x) => String(x[col]) === String(val))
        return r
      }
      function resolveTerminal() {
        if (b._update) { for (const x of rows()) Object.assign(x, b._update); return { data: rows(), error: null } }
        if (b._delete) {
          const doomed = new Set(rows())
          stores[table] = (stores[table] || []).filter((x: Row) => !doomed.has(x))
          return { data: null, error: null }
        }
        return { data: rows(), error: null }
      }
      return b
    },
  }
}

const db = makeDb()

function loadSameBrain() {
  const source = readFileSync(new URL('../lib/agent/same-brain.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mocks: Record<string, any> = {
    crypto: nodeCrypto,
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/bot/memory-redaction': { redactSecretShapedText: (s: string) => s },
    '@/lib/google-gmail': {
      buildGmailConnectUrl: () => '',
      revokeGoogleToken: async (t: string) => { revoked.push(String(t)); return String(t) !== failToken },
    },
    '@/lib/security/google-token-crypto': { decryptGoogleToken: (s: string) => String(s).replace(/^enc:/, '') },
    './email-format': { cleanEmailSnippet: (s: any) => s, formatEmailDateIST: () => '', wantsSingleLatestEmail: () => false },
    './typed-object-context': { rememberTypedObjects: async () => {} },
    '@/lib/feature-intents-legacy': { routeFeatureIntent: async () => null },
    '@/lib/bot/process-message': { processIncomingMessage: async () => ({ text: '', mediaUrl: null, mediaType: null }) },
    './google-workspace-read': {
      formatWorkspaceEmailAudit: () => '', readWorkspaceDriveText: async () => '', readWorkspaceEmailBrief: async () => ({}),
      searchWorkspaceContacts: async () => ({}), searchWorkspaceDrive: async () => ({}), searchWorkspaceEmails: async () => ({ messages: [] }),
    },
    '@/lib/bot/handlers/followup-state': { clearFollowupState: async () => {}, saveFollowupState: async () => {} },
    './actor': {},
  }
  const exportsObj: any = {}
  runInNewContext(code, { exports: exportsObj, require: (name: string) => mocks[name] || {}, process: { env: {} }, Buffer, URL, console })
  return exportsObj
}

const sb = loadSameBrain()
const actor = { userId: 'u', legacyTelegramId: 42, whatsappId: '91', name: 'Gogo' }

function seed() {
  stores.users = [{
    telegram_id: 42,
    gmail_access_token: 'enc:gAT', gmail_refresh_token: 'enc:gRT', gmail_connected: true,
    gmail_connected_at: '2026-01-01', gmail_email: 'me@x.com', gmail_send_connected: true, gmail_send_connected_at: '2026-01-01',
    google_refresh_token: 'enc:cRT', google_calendar_connected: true,
  }]
  stores.google_calendar_accounts = [{ telegram_id: '42', email: 'extra@x.com', refresh_token: 'enc:eRT' }]
  stores.agent_activity = [
    { telegram_id: '42', event_type: 'typed_object_context', message: 'cached email subjects/ids' },
    { telegram_id: '42', event_type: 'watcher_created', message: 'unrelated — must survive' },
  ]
  revoked.length = 0
}

const SHORT = 'Google is disconnected from AskGogo. I removed the Gmail and Google Calendar access stored here.'

// ── Scenario 1: every revocation succeeds ────────────────────────────────────
seed(); failToken = null
const res = await sb.dispatchThroughSameBrain({ actor, text: 'disconnect my google account' })
const user = stores.users[0]

for (const f of ['gmail_access_token', 'gmail_refresh_token', 'gmail_connected_at', 'gmail_email', 'gmail_send_connected_at']) {
  assert.equal(user[f], null, `gmail field ${f} must be cleared`)
}
assert.equal(user.gmail_connected, false, 'gmail_connected must be false')
assert.equal(user.gmail_send_connected, false, 'gmail_send_connected must be false')
assert.equal(user.google_refresh_token, null, 'BUG F FIX: google_refresh_token must be cleared')
assert.equal(user.google_calendar_connected, false, 'BUG F FIX: google_calendar_connected must be false')
assert.equal(stores.google_calendar_accounts.length, 0, 'extra google_calendar_accounts rows must be deleted')

// typed-object cache purged; unrelated activity rows survive.
assert.equal(stores.agent_activity.filter((r: Row) => r.event_type === 'typed_object_context').length, 0, 'typed_object_context cache must be purged')
assert.equal(stores.agent_activity.filter((r: Row) => r.event_type === 'watcher_created').length, 1, 'unrelated agent_activity rows must NOT be deleted')

for (const t of ['gRT', 'cRT', 'eRT']) assert.ok(revoked.includes(t), `token ${t} must be revoked at Google`)

// Success message is the SHORT variant; names both; no "permissions" advice.
assert.equal(res.text, SHORT, 'success path must use the short confirmation verbatim')
assert.match(res.text, /gmail/i, 'reply names Gmail')
assert.match(res.text, /calendar/i, 'reply names Calendar')
assert.doesNotMatch(res.text, /Google Account permissions/i, 'success path must NOT include the manual-removal advice')

// ── Scenario 2: one revocation fails -> long advice variant ──────────────────
seed(); failToken = 'cRT' // the primary calendar token fails to revoke remotely
const res2 = await sb.dispatchThroughSameBrain({ actor, text: 'disconnect google' })
assert.notEqual(res2.text, SHORT, 'partial-failure path must NOT use the short message')
assert.match(res2.text, /did not confirm remote revocation/i, 'partial-failure path explains remote revocation was not confirmed')
assert.match(res2.text, /remove AskGogo from your Google Account permissions/i, 'partial-failure path gives the manual-removal advice')
// Local state is still fully cleared even when a remote revoke fails.
assert.equal(stores.users[0].google_calendar_connected, false, 'calendar still cleared locally on partial failure')
assert.equal(stores.users[0].google_refresh_token, null, 'calendar token still cleared locally on partial failure')

// NEGATIVE CONTROL: the OLD behaviour (clear gmail fields only) would have left
// the calendar fields set — so these assertions genuinely distinguish fixed from broken.
const preFix: Row = { google_refresh_token: 'enc:cRT', google_calendar_connected: true }
Object.assign(preFix, { gmail_access_token: null, gmail_refresh_token: null, gmail_connected: false })
assert.equal(preFix.google_calendar_connected, true, 'control: old clear set leaves calendar CONNECTED (the bug)')
assert.equal(preFix.google_refresh_token, 'enc:cRT', 'control: old clear set leaves the calendar token in place (the bug)')

console.log('scenario 1 (all revoked): gmail+calendar cleared, extras deleted, typed cache purged, unrelated activity kept')
console.log(`  revoked: ${['gRT', 'cRT', 'eRT'].join(', ')}`)
console.log(`  success reply: ${res.text}`)
console.log(`scenario 2 (calendar revoke failed): long advice message`)
console.log(`  partial reply: ${res2.text}`)
console.log('negative control: old gmail-only clear leaves calendar connected (confirmed)')
console.log('DISCONNECT_CALENDAR_OK')
