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
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init: any) => {
  const url = String(input), token = String(init?.headers?.Authorization || '').replace('Bearer ', '')
  if (!url.startsWith('https://gmail.googleapis.com/')) return realFetch(input, init)
  if (token === 'tok-work' && workDown) return new Response('{}', { status: 500 })
  const mine = inbox[token]; if (!mine) return new Response('{}', { status: 401 })
  if (url.includes('/messages?')) return Response.json({ messages: mine.map(m => ({ id: m.id })) })
  const id = url.match(/messages\/([^?]+)/)![1]; const m = mine.find(x => x.id === id)!
  return Response.json({ id, threadId: `t-${id}`, snippet: m.snippet, payload: { headers: [{ name: 'Subject', value: m.subject }, { name: 'From', value: m.from }, { name: 'Date', value: new Date().toUTCString() }] } })
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
// The payment-receipt check now finds the CCAvenue confirmation Instinct found (6 Nov live).
const pc = await import('../lib/agent/payment-confirmation')
const p = pc.parsePaymentConfirmation('Payment Status: SUCCESS ,Merchant Name: KOTAK MAHINDRA PRIME LIMITED ,Amount: ₹41,898.00 ,Paid By: GOVERDHAN M DODDAMANE ,Amount Details: Savings A/c **********6355 ,HDFC Transaction ID: BAN016310IO0XLNHS9UL ,Reference Number: PIN056310E9529BHHMLK')!
assert.match(pc.receiptVerdict(p, found as any), /^Found the gateway's confirmation: CCAvenue: "Payment order successful - 6856147904"/)
console.log('✓ searches and the inbox watch read both mailboxes; the CCAvenue receipt is found')

// 4. A failing extra account never costs the primary's results; a failing primary still fails.
workDown = true
found = await read.searchWorkspaceEmailsByQuery(actor, '"41898"', 5)
assert.deepEqual(found.map((m: any) => m.id), ['p1'], 'work mailbox down: primary results still come back')
workDown = false
users[0].gmail_access_token = encryptGoogleToken('tok-dead'); users[0].gmail_refresh_token = ''
await assert.rejects(() => read.searchWorkspaceEmailsByQuery(actor, '"41898"', 5), /workspace_email_search_failed:401/)
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
