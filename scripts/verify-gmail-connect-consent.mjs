// Gmail consent on connect (4 Nov P1 hotfix, owner decision "connecting Gmail = yes"). Runs the real
// recordGmailConnectConsent in an inert VM over a synthetic table. No Supabase, Google or network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const src = readFileSync('lib/agent/gmail-consent.ts', 'utf8')
const ast = ts.createSourceFile('g.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'recordGmailConnectConsent')
const code = ts.transpileModule(fn.getText(ast).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
function run(rows, tg, { fail } = {}) {
  const ops = []
  const db = { from(t) { assert.equal(t, 'user_consent_settings'); const f = []; let ch = null, up = null
    const q = {
      select() { return q }, eq(k, v) { f.push([k, v, 'eq']); return q }, is(k, v) { f.push([k, v, 'is']); return run2() },
      maybeSingle() { if (fail === 'read') return Promise.resolve({ data: null, error: { message: 'x' } }); return Promise.resolve({ data: rows.find(r => f.every(([k, v]) => String(r[k]) === String(v))) || null, error: null }) },
      update(c) { ch = c; return q },
      upsert(row, o) { ops.push(['upsert', row, o]); if (fail === 'write') return Promise.resolve({ error: { message: 'w' } }); if (!rows.some(r => String(r.telegram_id) === String(row.telegram_id))) rows.push({ ...row }); return Promise.resolve({ error: null }) },
    }
    const run2 = () => { if (fail === 'write') return Promise.resolve({ error: { message: 'w' } }); for (const r of rows) if (f.every(([k, v, op]) => op === 'is' ? r[k] == v : String(r[k]) === String(v))) Object.assign(r, ch); ops.push(['update', ch]); return Promise.resolve({ error: null }) }
    return q } }
  const sb = { supabaseAdmin: db, Number, String, Error }
  vm.runInNewContext(code + '\nthis.f = recordGmailConnectConsent', sb)
  return { p: sb.f(tg), ops, rows }
}
{ const x = run([], '101'); assert.equal(await x.p, 'saved'); assert.deepEqual(x.rows, [{ telegram_id: '101', gmail_enabled: true }]) }
{ const rows = [{ telegram_id: '101', gmail_enabled: null }]; const x = run(rows, '101'); assert.equal(await x.p, 'saved'); assert.equal(rows[0].gmail_enabled, true) }
{ const rows = [{ telegram_id: '101', gmail_enabled: false }]; const x = run(rows, '101'); assert.equal(await x.p, 'kept_off'); assert.equal(rows[0].gmail_enabled, false); assert.equal(x.ops.length, 0, 'an explicit off is never overridden') }
{ const rows = [{ telegram_id: '101', gmail_enabled: true }]; const x = run(rows, '101'); assert.equal(await x.p, 'already_on'); assert.equal(x.ops.length, 0) }
{ const rows = [{ telegram_id: '202', gmail_enabled: null }]; const x = run(rows, '101'); assert.equal(await x.p, 'saved'); assert.equal(rows[0].gmail_enabled, null, 'another owner untouched') }
await assert.rejects(run([], 2 ** 53 + 2).p, /owner_identity_invalid:unsafe_number/)
await assert.rejects(run([], '10 1').p, /owner_identity_invalid:format/)
await assert.rejects(run([], '101', { fail: 'read' }).p, /gmail_consent_read_failed/)
await assert.rejects(run([], '101', { fail: 'write' }).p, /gmail_consent_write_failed/)
const cb = readFileSync('app/api/gmail/callback/route.ts', 'utf8')
assert.ok(cb.indexOf("Save Gmail tokens failed") > 0 && cb.indexOf("recordGmailConnectConsent(telegramId)") > cb.indexOf("Save Gmail tokens failed"), 'saved only after the Google connection itself is saved')
const page = readFileSync('app/dashboard/(app)/settings/email/page.tsx', 'utf8')
assert.match(page, /params\?\.connected === 'google' && composioAccount && session\?\.telegramId[\s\S]{0,200}recordGmailConnectConsent/, 'Composio return records only with a live connection')
const read = readFileSync('lib/agent/google-workspace-read.ts', 'utf8')
assert.match(read, /if\(consent\?\.gmail_enabled===false\)throw new Error\('workspace_email_reading_disabled'\)\n    if\(consent\?\.gmail_enabled!==true\)throw new Error\('workspace_email_consent_missing'\)/)
// Every Gmail reader requires the affirmative yes (4 Nov: the reviewer's draft covered two; five more treated a missing record as yes).
const gates = {
  'lib/agent/open-loops.ts': /if\(consent\?\.gmail_enabled!==true\)return \{reason:'disabled' as const\}/,
  'lib/bot/handlers/gmail-read.ts': /if\(consent\?\.gmail_enabled!==true\)return \{connected:false,disabled:true/,
  'lib/email/attention-store.ts': /if \(consent\?\.gmail_enabled !== true \|\| !user\?\.gmail_connected\) return null[\s\S]*async function readComposio[\s\S]{0,200}gmailConsentState\(telegramId\)[\s\S]{0,80}if \(consent !== 'on'\) return null/,
  'lib/agent/gmail-ticket-credential.ts': /gmailConsentState\(actor\.legacyTelegramId\)\) !== 'on'\) return null/,
  'lib/agent/appointment-auth-resume.ts': /gmailConsentState\(actor\.legacyTelegramId\)\) !== 'on'\) return null/,
  'lib/agent/gmail-send.ts': /gmailConsentState\(actor\.legacyTelegramId\)\)!=='on'\)return \{ok:false as const,reason:'gmail_consent_missing'/,
}
for (const [f, re] of Object.entries(gates)) assert.match(readFileSync(f, 'utf8'), re, f)
// No reader may be gated only on an explicit false: every `gmail_enabled===false` must be paired with a `!==true` gate.
for (const f of ['lib/agent/open-loops.ts', 'lib/bot/handlers/gmail-read.ts', 'lib/email/attention-store.ts', 'lib/agent/google-workspace-read.ts', 'lib/agent/watch-command.ts']) {
  const code = readFileSync(f, 'utf8')
  const onlyFalse = (code.match(/gmail_enabled\s*===\s*false/g) || []).length
  const affirmative = (code.match(/gmail_enabled\s*!==\s*true/g) || []).length
  assert.ok(affirmative >= 1 && affirmative >= onlyFalse, `${f}: ${onlyFalse} explicit-false checks but ${affirmative} affirmative gates`)
}
{
  const fn2 = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'gmailConsentState')
  const c2 = ts.transpileModule(fn2.getText(ast).replace(/^export\s+/, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const state = async (row, err) => { const sb = { Number, String, Error, supabaseAdmin: { from: () => ({ select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: row, error: err || null }) }) } }; vm.runInNewContext(c2 + '\nthis.f = gmailConsentState', sb); return sb.f('101') }
  assert.equal(await state({ gmail_enabled: true }), 'on')
  assert.equal(await state({ gmail_enabled: false }), 'off')
  assert.equal(await state({ gmail_enabled: null }), 'missing')
  assert.equal(await state(null), 'missing')
  assert.equal(await state({ gmail_enabled: 'true' }), 'missing', 'only boolean true is a yes')
  await assert.rejects(state(null, { message: 'x' }), /gmail_consent_read_failed/)
}
console.log('PASS: Gmail yes saved on connect (Google or Composio), explicit off kept, other owners untouched, unsafe ids and DB errors fail closed')
