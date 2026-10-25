import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as crypto from 'node:crypto'
import ts from 'typescript'
const exports: any = {}
const source = readFileSync(process.env.ADMIN_COOKIE_AUDIT_SOURCE || 'lib/admin/console-auth.ts', 'utf8')
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports, Buffer, Date, process: { env: { DASHBOARD_THROTTLE_PEPPER: 'fixture-only-cookie-pepper' } },
  require: (name: string) => { if (name === 'node:crypto') return crypto; if (['next/headers','@/lib/supabase-admin','@/lib/dashboard/session','@/lib/bot/handlers/admin-analytics'].includes(name)) return {}; throw Error('Unexpected dependency ' + name) },
})
const hash = exports.hashPassword('inert fixture password')
const value = exports.signConsoleCookie('+919999999999', hash, 1000)
const [payload, sig] = value.split('.')
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const noncanonical = sig.slice(0, -1) + alphabet[alphabet.indexOf(sig.at(-1)) | 1]
assert.equal(Buffer.from(noncanonical, 'base64url').toString('hex'), Buffer.from(sig, 'base64url').toString('hex'), 'negative control alters only ignored base64 padding bits')
assert.equal(exports.readConsoleCookie(value, '+919999999999', hash, 2000), true)
assert.equal(exports.readConsoleCookie(`${payload}.${noncanonical}`, '+919999999999', hash, 2000), false, 'noncanonical signature rejected even when decoded HMAC matches')
for (const invalid of [value + '.extra', value + '.', value + '=', `${payload}.${sig.slice(0, -2)}!`, `.${sig}`, `${payload}.`]) {
  assert.equal(exports.readConsoleCookie(invalid, '+919999999999', hash, 2000), false, invalid)
}
assert.equal(exports.readConsoleCookie(value, '+918888888888', hash, 2000), false)
assert.equal(exports.readConsoleCookie(value, '+919999999999', hash, 1000 + exports.ADMIN_SESSION_MS), false)
console.log('Canonical admin cookies: valid control, equivalent-byte signature alias, malformed/trailing segments, owner and expiry passed')
