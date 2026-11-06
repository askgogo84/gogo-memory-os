// Synthetic original-module regression: shared-memory topic grants must never
// select a different country's account by the same final ten phone digits.
// No real Supabase, memory content, credentials, network, sends or sharing.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type UserRow = { telegram_id: string | number | null; whatsapp_id: string }
type Fixture = { phone?: string | null; users?: UserRow[]; contactError?: boolean; usersError?: boolean; topicCount?: number }
const source = readFileSync('lib/bot/handlers/shared-memory.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText

function fixture(options: Fixture) {
  const calls: { table: string; method: string; field?: string; value?: unknown }[] = []
  const writes: unknown[] = []
  const fakeDb = {
    from(table: string) {
      calls.push({ table, method: 'from' })
      const filters: Record<string, any> = {}
      const query: any = {
        select(_fields: string, _opts?: any) { return query },
        eq(field: string, value: unknown) {
          calls.push({ table, method: 'eq', field, value }); filters[field] = value
          return query
        },
        in(field: string, value: string[]) {
          calls.push({ table, method: 'in', field, value }); filters[field] = value
          return query
        },
        not(_field: string, _op: string, _v: unknown) { return query },
        is(_field: string, _v: unknown) {
          if (table !== 'memory_embeddings') throw new Error('unexpected is')
          return Promise.resolve({ count: options.topicCount ?? 1, error: null })
        },
        maybeSingle() {
          if (table !== 'friend_contacts') throw new Error('unexpected maybeSingle')
          const found = filters.name === 'alex' && filters.owner_telegram_id === 1001 && options.phone
          return Promise.resolve({
            data: found ? { whatsapp_id: options.phone } : null,
            error: options.contactError ? { message: 'injected contact read error' } : null,
          })
        },
        limit(n: number) {
          if (table !== 'users') throw new Error('unexpected limit')
          const matched = (options.users || []).filter(r => filters.whatsapp_id?.includes(r.whatsapp_id) && r.telegram_id !== null)
          return Promise.resolve({ data: matched.slice(0, n), error: options.usersError ? { message: 'injected user read error' } : null })
        },
        upsert(payload: any) {
          if (table !== 'memory_shares') throw new Error('unexpected upsert')
          writes.push(payload)
          return Promise.resolve({ error: null })
        },
      }
      return query
    },
  }
  const exported: any = {}
  runInNewContext(compiled, {
    exports: exported,
    console,
    require(id: string) {
      if (id === '@/lib/supabase-admin') return { supabaseAdmin: fakeDb }
      if (id === '@/lib/services/embeddings') return { embedText: () => { throw new Error('network blocked') } }
      if (id === '@/lib/services/memory-index') return { indexMemory: () => { throw new Error('network blocked') } }
      throw new Error('unexpected module ' + id)
    },
  }, { timeout: 1000 })
  return { functions: exported, calls, writes }
}

const US = { telegram_id: 2002, whatsapp_id: 'whatsapp:+14155552671' }
const IN = { telegram_id: 3003, whatsapp_id: 'whatsapp:+914155552671' }

assert.match(source, /\.in\('whatsapp_id', shareRecipientPhoneCandidates\(fullPhone\)\)/, 'must use exact lookup')
assert.doesNotMatch(source.slice(source.indexOf('export async function resolveRecipientTelegramId'), source.indexOf('export async function grantShare')), /\.ilike\(/, 'no suffix lookup in grant recipient resolver')
const f = fixture({ phone: '+1 (415) 555-2671', users: [IN, US] })
assert.equal(f.functions.canonicalShareRecipientPhone('+1 (415) 555-2671'), '14155552671')
assert.equal(f.functions.canonicalShareRecipientPhone('whatsapp:+914155552671'), '914155552671')
assert.equal(f.functions.canonicalShareRecipientPhone('4155552671'), null, 'ten digits without country must fail closed')
assert.equal(f.functions.canonicalShareRecipientPhone('whatsapp:+14155552671;evil'), null)
assert.equal(f.functions.canonicalShareRecipientPhone('http://attacker.example'), null)
assert.equal(f.functions.exactShareRecipientOwnerId('9007199254740993'), null, 'BIGINT precision collision denied')
assert.equal(f.functions.exactShareRecipientOwnerId(9007199254740992), null)
assert.equal(f.functions.exactShareRecipientOwnerId('123garbage'), null)
assert.equal(f.functions.exactShareRecipientOwnerId('2002'), 2002)
assert.equal(f.functions.exactShareRecipientOwnerId(-202), -202)
assert.equal(f.functions.exactShareRecipientOwnerId(0), null)

const USmatch = await f.functions.resolveRecipientTelegramId(1001, 'alex')
assert.equal(USmatch.telegramId, 2002, 'complete US identity must not authorize an Indian owner')
assert.equal(USmatch.hasContact, true)
assert.equal(f.calls.filter(c => c.table === 'users' && c.method === 'in').length, 1)
assert.equal(f.calls.filter(c => c.table === 'users' && c.method === 'in')[0].value.includes('whatsapp:+14155552671'), true)
assert.equal(f.calls.filter(c => c.table === 'users' && c.method === 'in')[0].value.includes('whatsapp:+914155552671'), false)
assert.equal(f.writes.length, 0, 'recipient resolution is read-only')
const reply = await f.functions.handleBucketCommand(1001, 'share my travel topic with alex')
assert.match(reply, /Shared your/)
assert.equal(f.writes.length, 1)
assert.equal(f.writes[0].recipient_telegram_id, 2002, 'same last ten digits must never grant wrong recipient')

for (const [label, options] of [
  ['India matches India alone', { phone: '+914155552671', users: [US, IN] }],
  ['ambiguous same-phone owners', { phone: '+14155552671', users: [US, { ...US, telegram_id: 5555 }] }],
  ['no saved recipient account', { phone: '+14155552671', users: [IN] }],
  ['lookup error', { phone: '+14155552671', users: [US], usersError: true }],
  ['contact lookup error', { phone: '+14155552671', users: [US], contactError: true }],
  ['domestic-only saved phone', { phone: '4155552671', users: [US] }],
  ['malformed recipient owner', { phone: '+14155552671', users: [{ ...US, telegram_id: '2002garbage' }] }],
  ['unsafe recipient BIGINT', { phone: '+14155552671', users: [{ ...US, telegram_id: '9007199254740993' }] }],
] as [string, Fixture][]) {
  const test = fixture(options)
  const result = await test.functions.resolveRecipientTelegramId(1001, 'alex')
  assert.equal(result.telegramId, label === 'India matches India alone' ? 3003 : null, label)
  if (label !== 'India matches India alone') {
    const answer = await test.functions.handleBucketCommand(1001, 'share my travel topic with alex')
    assert.doesNotMatch(answer, /Shared your/, label)
    assert.equal(test.writes.length, 0, label + ' must never grant')
  }
}
const invalid = fixture({ phone: '+14155552671', users: [US] })
assert.equal((await invalid.functions.resolveRecipientTelegramId(9007199254740992, 'alex')).telegramId, null)
assert.equal(invalid.calls.length, 0, 'unsafe requesting owner must not touch the DB')

console.log('verify-shared-memory-recipient-owner: PASS — exact E.164, ambiguity, errors, owner precision, no network')
