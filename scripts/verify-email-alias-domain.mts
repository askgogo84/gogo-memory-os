// P1: email-to-owner lookup must identify a complete mailbox in the exact inbound domain.
// Inert actual-module regression: no provider, database, credentials, messages or network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const exports: Record<string, unknown> = {}
let backendCalls = 0
const source = readFileSync('lib/email/aliases.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
runInNewContext(compiled, {
  exports,
  require: (name: string) => {
    if (name === 'node:crypto') return { randomInt: () => 0 }
    if (name === '@/lib/supabase-admin') return { supabaseAdmin: {
      from: () => { backendCalls++; throw new Error('Offline alias test attempted DB access') },
    } }
    throw new Error('Unexpected dependency: ' + name)
  },
  process: { env: { EMAIL_INBOUND_DOMAIN: 'in.askgogo.in' } },
  String, RegExp, Number, Object, console,
}, { timeout: 5000 })

const aliasFromAddress = exports.aliasFromAddress as (address: string) => string | null
assert.equal(typeof aliasFromAddress, 'function')

const ALIAS = 'victim-k7q2mx'
const DOMAIN = 'in.askgogo.in'
const accepted: Array<[string, string]> = [
  [`${ALIAS}@${DOMAIN}`, ALIAS],
  [`${ALIAS}+gmail@${DOMAIN}`, ALIAS],
  [`Display Name <${ALIAS}@${DOMAIN}>`, ALIAS],
  [`Display Name <${ALIAS}+gmail@${DOMAIN}>`, ALIAS],
  [`  DISPLAY NAME <VICTIM-K7Q2MX@IN.ASKGOGO.IN>  `, ALIAS],
]
for (const [input, expected] of accepted) {
  assert.equal(aliasFromAddress(input), expected, 'exact mailbox rejected: ' + input)
}

const rejected = [
  `${ALIAS}@${DOMAIN}.attacker.example`,   // no suffix-authorized foreign domain
  `${ALIAS}@${DOMAIN}evil.com`,
  `Display <${ALIAS}@${DOMAIN}.attacker.example>`,
  `https://attacker.example/?to=${ALIAS}@${DOMAIN}`,
  `foo+${ALIAS}@${DOMAIN}`,                  // not a full alias mailbox
  `other@external.example, ${ALIAS}@${DOMAIN}`, // ambiguous multiple recipients
  `other@external.example, Display <${ALIAS}@${DOMAIN}>`, // display wrapper cannot hide another recipient
  `<${ALIAS}@${DOMAIN}>, other@external.example`,
  `evil-${ALIAS}@${DOMAIN}`, // not a complete generated alias (embedded substring)
  `${ALIAS}@example.com`,
  `${ALIAS}@${DOMAIN}?subject=secret`,
]
for (const input of rejected) {
  assert.equal(aliasFromAddress(input), null, 'foreign/embedded/ambiguous recipient resolved: ' + input)
}
assert.equal(backendCalls, 0)
const webhook = readFileSync('app/api/email/resend-inbound/route.ts', 'utf8')
assert.match(webhook, /aliasFromAddress\(r\)/, 'the production Resend route uses this exact recipient parser')
console.log('email alias exact-domain and complete-recipient binding: all inert checks passed')
