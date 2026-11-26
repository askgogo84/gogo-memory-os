// Second Google account (owner, 6 Nov: "Connect both goverdhan.md@gmail.com and goverdhan@tipplr.in"). The primary
// stays in users; later accounts live in gmail_accounts; readers merge both; one failing never loses the other.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
const { supabaseAdmin } = await import('../lib/supabase-admin')
const { encryptGoogleToken, decryptGoogleToken } = await import('../lib/security/google-token-crypto')

// Fake database: users (one row), user_consent_settings, gmail_accounts.
const TG = -4500000001
const users: any[] = [{ telegram_id: TG, gmail_connected: true, gmail_email: 'goverdhan.md@gmail.com', gmail_access_token: encryptGoogleToken('tok-primary'), gmail_refresh_token: encryptGoogleToken('ref-primary') }]
const consent: any[] = [{ telegram_id: TG, gmail_enabled: true }]
const accounts: any[] = []
let accountsTableMissing = false
const table = (name: string) => {
  const rows = name === 'users' ? users : name === 'user_consent_settings' ? consent : name === 'gmail_accounts' ? accounts : null
  if (!rows) throw new Error('unexpected table ' + name)
  const f: ((r: any) => boolean)[] = []; let mode: 'select' | 'update' | 'upsert' = 'select'; let payload: any = null
  const b: any = {
    select() { return b }, update(p: any) { mode = 'update'; payload = p; return b }, upsert(p: any) { mode = 'upsert'; payload = p; return b },
    eq(k: string, v: any) { f.push(r => String(r[k]) === String(v)); return b }, is(k: string, v: any) { f.push(r => r[k] == v); return b },
    order() { return b }, limit() { return b }, maybeSingle() { b.single = true; return b },
    then(res: any, rej: any) {
      if (name === 'gmail_accounts' && accountsTableMissing) return Promise.resolve({ data: null, error: { message: 'relation "public.gmail_accounts" does not exist' } }).then(res, rej)
      if (mode === 'upsert') { const i = rows.findIndex(r => r.telegram_id === payload.telegram_id && r.email === payload.email); if (i >= 0) rows[i] = { ...rows[i], ...payload }; else rows.push({ id: `acc-${rows.length + 1}`, connected_at: new Date().toISOString(), ...payload }); return Promise.resolve({ error: null }).then(res, rej) }
      const hit = rows.filter(r => f.every(fn => fn(r)))
      if (mode === 'update') { hit.forEach(r => Object.assign(r, payload)); return Promise.resolve({ data: hit.map(r => ({ id: r.id })), error: null }).then(res, rej) }
      return Promise.resolve({ data: b.single ? hit[0] || null : hit, error: null }).then(res, rej)
    },
  }
  return b
}
;(supabaseAdmin as any).from = table

// Fake Google: each token sees its own inbox.
const inbox: Record<string, { id: string; from: string; subject: string; snippet: string }[]> = {
  'tok-primary': [{ id: 'p1', from: 'HDFC Bank InstaAlerts <alerts@hdfcbank.bank.in>', subject: 'Confirmation of Payment Using HDFC NetBanking', snippet: 'Amount: Rs. 41898.00' }],
  'tok-work': [{ id: 'w1', from: 'CCAvenue <no-reply@ccavenue.com>', subject: 'Payment order successful - 6856147904', snippet: 'Rs 41,898.00 to Kotak Mahindra Prime Limited' }],
}
let workDown = false
let workMetadataDown = false
let primaryMore = false
let primaryPageOverride: Record<string, unknown> | null = null
let workMetadataMismatch = false
let primaryMetadataReads = 0
let primaryPages: Record<string, Record<string, unknown> | null> | null = null
let listRequests: [string, string][] = []
let listQueries: string[] = []
let workAfterList: (() => void) | null = null
let workMetadataReads = 0
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input), token = String(init?.headers?.Authorization || '').replace('Bearer ', '')
  if (!url.startsWith('https://gmail.googleapis.com/')) return realFetch(input, init)
  if (token === 'tok-work' && workDown) return new Response('{}', { status: 500 })
  const mine = inbox[token]; if (!mine) return new Response('{}', { status: 401 })
  if (url.includes('/messages?')) {
    const cursor = new URL(url).searchParams.get('pageToken') || ''
    listRequests.push([token, cursor])
    listQueries.push(new URL(url).searchParams.get('q') || '')
    if (token === 'tok-primary' && primaryPages) {
      const page = primaryPages[cursor]
      return page ? Response.json(page) : new Response('{}', { status: 503 })
    }
    if (token === 'tok-work' && workAfterList) workAfterList()
    return Response.json(token === 'tok-primary' && primaryPageOverride ? primaryPageOverride : { messages: mine.map(m => ({ id: m.id })), ...(token === 'tok-primary' && primaryMore ? { nextPageToken: 'fixture-opaque-page-token' } : {}) })
  }
  if (token === 'tok-work') workMetadataReads++
  if (token === 'tok-work' && workMetadataDown) return new Response('{}', { status: 503 })
  const id = url.match(/messages\/([^?]+)/)![1]; const m = mine.find(x => x.id === id)!
  if (token === 'tok-primary') primaryMetadataReads++
  return Response.json({ id: token === 'tok-work' && workMetadataMismatch ? 'foreign-fixture-id' : id, threadId: `t-${id}`, snippet: m.snippet, payload: { headers: [{ name: 'Subject', value: m.subject }, { name: 'From', value: m.from }, { name: 'Date', value: new Date().toUTCString() }] } })
}) as any
const actor: any = { userId: 'u1', legacyTelegramId: TG, whatsappId: '918884501501', name: 'Goverdhan' }
const read = await import('../lib/agent/google-workspace-read')

// 1. Only the primary: unchanged behaviour, even when the gmail_accounts table does not exist yet.
accountsTableMissing = true
let found = await read.searchWorkspaceEmailsByQuery(actor, '"41898"', 5)
assert.deepEqual(found.map((m: any) => m.id), ['p1']); assert.equal((found[0] as any).account, undefined)
accountsTableMissing = false
console.log('✓ before the migration runs, nothing changes (missing table = no extra accounts)')

// 2. The second account is added beside the first, never in its place.
const ga = await import('../lib/agent/gmail-accounts')
await ga.upsertExtraGmailAccount(TG, 'Goverdhan@tipplr.in', { access_token: 'tok-work', refresh_token: 'ref-work', scope: 'gmail.readonly' })
assert.equal(users[0].gmail_email, 'goverdhan.md@gmail.com', 'primary untouched')
assert.equal(accounts.length, 1); assert.equal(accounts[0].email, 'goverdhan@tipplr.in', 'lower-cased')
assert.notEqual(accounts[0].refresh_token, 'ref-work', 'stored encrypted'); assert.equal(decryptGoogleToken(accounts[0].refresh_token), 'ref-work')
const extras = await ga.listExtraGmailAccounts(TG)
assert.deepEqual(extras.map(a => [a.email, a.accessToken]), [['goverdhan@tipplr.in', 'tok-work']])
assert.deepEqual(await ga.listExtraGmailAccounts(-4500000002), [], 'owner-scoped')
console.log('✓ the work account is stored beside the primary, encrypted, owner-scoped')

// 3. Readers merge both inboxes; each message says which account it came from.
found = await read.searchWorkspaceEmailsByQuery(actor, '"41898"', 5)
assert.deepEqual(found.map((m: any) => [m.id, m.account || 'primary']).sort(), [['p1', 'primary'], ['w1', 'goverdhan@tipplr.in']])
const recent = await read.listRecentWorkspaceInbox(actor, 12)
assert.deepEqual(recent.messages.map((m: any) => m.id).sort(), ['p1', 'w1'])
// #1644: bounded inbox coverage must be explicit, never a whole-project all-clear.
assert.equal(recent.coverage.accountDiscovery, 'best_effort')
assert.equal(recent.coverage.accountDiscoveryStatus, 'read')
accountsTableMissing = true
const discoveryUnavailable = await read.listRecentWorkspaceInbox(actor, 12)
assert.deepEqual(discoveryUnavailable.messages.map(m => m.id), ['p1'])
assert.equal(discoveryUnavailable.coverage.accountDiscoveryStatus, 'unavailable', 'unknown extra account discovery is not a complete account set')
accountsTableMissing = false
// Exactly the configured cap is conservatively bounded: do not assume there is no sixth account.
const extraFixture = accounts[0]
for (let i = 2; i <= 5; i++) accounts.push({ ...extraFixture, id: 'acc-fixture-' + i, email: 'fixture-' + i + '@example.invalid' })
const capped = await read.listRecentWorkspaceInbox(actor, 12)
assert.equal(capped.coverage.accountDiscoveryStatus, 'bounded')
assert.equal(capped.coverage.pages.length, 6)
accounts.splice(1)

assert.deepEqual(recent.coverage.pages, [
  { accountId: null, status: 'read', listed: 1, metadataRead: 1, metadataFailed: 0, notAttempted: 0, hasMore: false },
  { accountId: accounts[0].id, status: 'read', listed: 1, metadataRead: 1, metadataFailed: 0, notAttempted: 0, hasMore: false },
])
primaryMore = true; workMetadataDown = true
const partial = await read.listRecentWorkspaceInbox(actor, 12)
assert.deepEqual(partial.messages.map(m => m.id), ['p1'], 'keep available primary evidence')
assert.deepEqual(partial.coverage.pages, [
  { accountId: null, status: 'read', listed: 1, metadataRead: 1, metadataFailed: 0, notAttempted: 0, hasMore: true },
  { accountId: accounts[0].id, status: 'read', listed: 1, metadataRead: 0, metadataFailed: 1, notAttempted: 0, hasMore: false },
])
assert.ok(!JSON.stringify(partial.coverage).includes('fixture-opaque-page-token'), 'do not expose provider cursor')
primaryMore = false; workMetadataDown = false
const recovered = await read.listRecentWorkspaceInbox(actor, 12)
assert.deepEqual(recovered.messages.map(m => m.id).sort(), ['p1', 'w1'], 'next read retries failed metadata')
assert.equal(recovered.coverage.pages[1].metadataFailed, 0)
// Checkpoint evidence must not count duplicates, coerced IDs, invalid cursors or mismatched metadata as covered.
primaryPageOverride = { messages: [{ id: 'p1' }, { id: 'p1' }, { id: 42 }, { id: ' ' }], nextPageToken: { malformed: true } }
primaryMetadataReads = 0
workMetadataMismatch = true
const invalidEvidence = await read.listRecentWorkspaceInbox(actor, 12)
assert.deepEqual(invalidEvidence.messages.map(m => m.id), ['p1'])
assert.equal(primaryMetadataReads, 1, 'duplicate and malformed list IDs must not cause extra reads')
assert.deepEqual(invalidEvidence.coverage.pages, [
  { accountId: null, status: 'read', listed: 4, metadataRead: 1, metadataFailed: 0, notAttempted: 3, hasMore: null },
  { accountId: accounts[0].id, status: 'read', listed: 1, metadataRead: 0, metadataFailed: 1, notAttempted: 0, hasMore: false },
])
primaryPageOverride = null; workMetadataMismatch = false
const afterInvalid = await read.listRecentWorkspaceInbox(actor, 12)
assert.deepEqual(afterInvalid.messages.map(m => m.id).sort(), ['p1', 'w1'], 'recovery reads the expected message again')
// #1644: bounded opt-in pagination, using only synthetic provider pages.
const burst = Array.from({length: 51}, (_, i) => ({id: 'burst-' + i, from: 'fixture@example.invalid', subject: 'fixture', snippet: 'fixture'}))
inbox['tok-primary'].push(...burst)
const idsFor = (start: number, end: number) => burst.slice(start, end).map(m => ({id: m.id}))
primaryPages = {
  '': {messages: idsFor(0, 20), nextPageToken: 'fixture-page-2'},
  'fixture-page-2': {messages: idsFor(20, 40), nextPageToken: 'fixture-page-3'},
  'fixture-page-3': {messages: idsFor(40, 51)},
}
listRequests = []
const singlePage = await read.listRecentWorkspaceInbox(actor, 20)
assert.equal(singlePage.messages.length, 21, 'legacy callers read one page per account')
assert.deepEqual(listRequests.filter(([token]) => token === 'tok-primary'), [['tok-primary', '']])
listRequests = []
const catchup = await read.listRecentWorkspaceInbox(actor, 20, 3)
assert.equal(catchup.messages.length, 52, 'all 51 burst messages plus the work mailbox')
assert.ok(catchup.messages.some(m => m.id === 'burst-50'), 'older page evidence is not dropped')
assert.deepEqual(catchup.coverage.pages[0], {accountId:null,status:'read',listed:51,metadataRead:51,metadataFailed:0,notAttempted:0,hasMore:false})
assert.deepEqual(listRequests.filter(([token]) => token === 'tok-primary'), [['tok-primary',''],['tok-primary','fixture-page-2'],['tok-primary','fixture-page-3']])
assert.deepEqual(listRequests.filter(([token]) => token === 'tok-work'), [['tok-work','']], 'primary token never crosses accounts')
assert.ok(!JSON.stringify(catchup).includes('fixture-page-2'), 'cursor is not returned')
const budgeted = await read.listRecentWorkspaceInbox(actor, 20, 2)
assert.equal(budgeted.coverage.pages[0].metadataRead, 40)
assert.equal(budgeted.coverage.pages[0].hasMore, true, 'budget exhaustion is incomplete coverage')
primaryPages['fixture-page-2'] = null
const failedLater = await read.listRecentWorkspaceInbox(actor, 20, 3)
assert.equal(failedLater.messages.length, 21, 'later failure preserves earlier evidence and other account')
assert.equal(failedLater.coverage.pages[0].hasMore, null, 'failed continuation is unknown')
primaryPages['fixture-page-2'] = {messages: [{id:'burst-0'}, {id:'burst-20'}], nextPageToken:'fixture-page-2'}
listRequests = []
const repeated = await read.listRecentWorkspaceInbox(actor, 20, 4)
assert.equal(repeated.messages.filter(m => m.id === 'burst-0').length, 1, 'cross-page duplicate is not read twice')
assert.equal(repeated.coverage.pages[0].notAttempted, 1)
assert.equal(repeated.coverage.pages[0].hasMore, null, 'cursor loop is not a complete scan')
assert.equal(listRequests.filter(([token]) => token === 'tok-primary').length, 2, 'loop never issues another request')
listRequests = []
await assert.rejects(() => read.listRecentWorkspaceInbox(actor, 20, 5), /workspace_email_recent_page_budget_invalid/)
assert.equal(listRequests.length, 0, 'invalid budget makes no provider reads')
// Fixed windows are explicit, replayable and do not slide as time passes.
listQueries = []
await read.listRecentWorkspaceInbox(actor, 12)
assert.ok(listQueries.length > 0 && listQueries.every(q => q === 'in:inbox newer_than:2d'), 'legacy query unchanged')
const fixedWindow = {afterEpochSeconds: 1795478400, beforeEpochSeconds: 1795564800}
listQueries = []
const fixed = await read.listRecentWorkspaceInbox(actor, 20, 2, fixedWindow)
const fixedQuery = 'in:inbox after:1795478400 before:1795564800'
assert.ok(listQueries.length > 0 && listQueries.every(q => q === fixedQuery), 'all pages and accounts use exact fixed query')
assert.deepEqual(fixed.coverage.window, fixedWindow, 'coverage is bound to the explicit query window')
assert.notEqual(fixed.coverage.window, fixedWindow, 'coverage is a snapshot, not caller-owned mutable object')
const replayQueries = [...listQueries]
listQueries = []
await read.listRecentWorkspaceInbox(actor, 20, 2, {...fixedWindow})
assert.deepEqual(listQueries, replayQueries, 'replay reconstructs identical provider query')
assert.equal(recent.coverage.window, undefined, 'legacy scan is not a fixed-window proof')
for (const bad of [null, {}, {afterEpochSeconds: '1795478400', beforeEpochSeconds: 1795564800}, {afterEpochSeconds: 1.5, beforeEpochSeconds: 2}, {afterEpochSeconds: 0, beforeEpochSeconds: 2}, {afterEpochSeconds: 2, beforeEpochSeconds: 2}, {afterEpochSeconds: 3, beforeEpochSeconds: 2}, {afterEpochSeconds: 1, beforeEpochSeconds: 604802}, {afterEpochSeconds: 1, beforeEpochSeconds: Infinity}, {afterEpochSeconds: 9999999999, beforeEpochSeconds: 10000000000}]) {
  listQueries = []
  await assert.rejects(() => read.listRecentWorkspaceInbox(actor, 20, 2, bad as any), /workspace_email_recent_window_invalid/)
  assert.equal(listQueries.length, 0, 'invalid fixed window makes no provider reads')
}
primaryPages = null
inbox['tok-primary'].splice(1)
// Fixed-window catch-up cannot keep reading with a discovered token after the
// exact account is disconnected or its identity changes during the scan.
for (const change of ['disconnect', 'identity-change', 'lookup-unavailable']) {
  const row = accounts[0]
  const original = {...row}
  workAfterList = () => {
    if (change === 'disconnect') row.disconnected_at = new Date().toISOString()
    if (change === 'identity-change') row.email = 'different@example.invalid'
    if (change === 'lookup-unavailable') accountsTableMissing = true
  }
  workMetadataReads = 0
  try {
    const interrupted = await read.listRecentWorkspaceInbox(actor, 20, 2, fixedWindow)
    assert.deepEqual(interrupted.messages.map(m => m.id), ['p1'], change + ': keep other mailbox evidence only')
    assert.equal(workMetadataReads, 0, change + ': do not use stale credentials for metadata')
    assert.equal(interrupted.coverage.pages[1].metadataFailed, 1, change + ': incomplete evidence')
  } finally {
    Object.assign(row, original)
    accountsTableMissing = false
    workAfterList = null
  }
}
const revalidated = await read.listRecentWorkspaceInbox(actor, 20, 2, fixedWindow)
assert.deepEqual(revalidated.messages.map(m => m.id).sort(), ['p1','w1'], 'restored mailbox is read again')
// The payment-receipt check now finds the CCAvenue confirmation Instinct found (6 Nov live).
const pc = await import('../lib/agent/payment-confirmation')
const p = pc.parsePaymentConfirmation('Payment Status: SUCCESS ,Merchant Name: KOTAK MAHINDRA PRIME LIMITED ,Amount: ₹41,898.00 ,Paid By: GOVERDHAN M DODDAMANE ,Amount Details: Savings A/c **********6355 ,HDFC Transaction ID: BAN016310IO0XLNHS9UL ,Reference Number: PIN056310E9529BHHMLK')!
assert.match(pc.receiptVerdict(p, found as any), /^Found the gateway's confirmation: CCAvenue: "Payment order successful - 6856147904"/)
console.log('✓ searches and the inbox watch read both mailboxes; the CCAvenue receipt is found')

// 4. A failing extra account never costs the primary's results; a failing primary still fails.
workDown = true
found = await read.searchWorkspaceEmailsByQuery(actor, '"41898"', 5)
assert.deepEqual(found.map((m: any) => m.id), ['p1'], 'work mailbox down: primary results still come back')
const extraUnavailable = await read.listRecentWorkspaceInbox(actor, 12)
assert.deepEqual(extraUnavailable.messages.map(m => m.id), ['p1'])
assert.deepEqual(extraUnavailable.coverage.pages[1], { accountId: accounts[0].id, status: 'failed', listed: null, metadataRead: null, metadataFailed: null, notAttempted: null, hasMore: null }, 'failed mailbox is not an empty mailbox')
workDown = false
users[0].gmail_access_token = encryptGoogleToken('tok-dead'); users[0].gmail_refresh_token = ''
await assert.rejects(() => read.searchWorkspaceEmailsByQuery(actor, '"41898"', 5), /workspace_email_search_failed:401/)
await assert.rejects(() => read.listRecentWorkspaceInbox(actor, 12), /workspace_email_recent_failed:401/)
users[0].gmail_access_token = encryptGoogleToken('tok-primary'); users[0].gmail_refresh_token = encryptGoogleToken('ref-primary')
console.log('✓ one account failing never hides the other; the primary failing is still reported')

// 5. Disconnect, and the chat commands.
assert.equal(await ga.disconnectExtraGmailAccount(TG, 'goverdhan@tipplr.in'), true)
assert.deepEqual(await ga.listExtraGmailAccounts(TG), [])
assert.equal(accounts[0].refresh_token, null, 'tokens cleared on disconnect')
for (const t of ['connect another gmail', 'add my work google account', 'connect goverdhan@tipplr.in', 'link a second gmail account']) assert.ok(ga.ADD_ACCOUNT_RE.test(t), t)
for (const t of ['connect gmail', 'connect my calendar']) assert.equal(ga.ADD_ACCOUNT_RE.test(t), false, t)
assert.equal(ga.REMOVE_ACCOUNT_RE.exec('disconnect goverdhan@tipplr.in')![1], 'goverdhan@tipplr.in')
const cb = readFileSync('app/api/gmail/callback/route.ts', 'utf8')
assert.match(cb, /primary !== email\.toLowerCase\(\)\) \{\n      if \(!tokens\.refresh_token\) return/, 'a second account needs a durable token')
assert.match(cb, /m\.upsertExtraGmailAccount\(telegramId, email, tokens\)/)
assert.match(readFileSync('lib/email/attention-store.ts', 'utf8'), /listExtraGmailAccounts\(telegramId\)/, '"any important emails?" reads the extras')
assert.match(readFileSync('lib/bot/handlers/gmail-read.ts', 'utf8'), /Add another Google account/)
assert.match(readFileSync('supabase/migrations/20261106160000_gmail_accounts.sql', 'utf8'), /DO NOT RUN WITHOUT OWNER APPROVAL\. Project: qenhjcooyecmatwducpu/)
console.log('✓ disconnect clears tokens; "connect another gmail" and "disconnect <address>" are commands; migration prepared, not run')
console.log('Second Gmail account checks passed')
