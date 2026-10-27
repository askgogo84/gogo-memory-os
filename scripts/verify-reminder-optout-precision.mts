// P1 defensive consent gate: STOP must preserve exact owner identities, not rounded JS numbers.
// INERT: actual production module transpiled into VM with synthetic database and phones;
// no Supabase client, Twilio, network, real recipient or production operation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { randomBytes } from 'node:crypto'

const identity: any = {}
runInNewContext(ts.transpileModule(readFileSync('lib/dashboard/owner-identity.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: identity,
  require: (name: string) => {
    assert.equal(name, 'node:crypto')
    return { randomBytes }
  },
  BigInt, Buffer,
})

let ownerRows: any[] = []
let optedRows: any[] = []
const inserts: any[] = []
const queried: Record<string, unknown>[] = []
let tableCalls = 0
const db = {
  from(table: string): any {
    tableCalls++
    if (table === 'friend_contacts') {
      return {
        select() { return this },
        eq(column: string, value: unknown) {
          assert.equal(column, 'whatsapp_id')
          assert.equal(value, '+15555550101')
          return Promise.resolve({ data: ownerRows, error: null })
        },
      }
    }
    if (table === 'reminder_optout') {
      const filter: Record<string, unknown> = {}
      return {
        upsert: async (rows: any[], options: any) => {
          assert.equal(options.onConflict, 'owner_telegram_id,recipient_whatsapp_id')
          inserts.push(...rows)
          return { error: null }
        },
        select() { return this },
        eq(column: string, value: unknown) { filter[column] = value; return this },
        maybeSingle: async () => {
          queried.push({ ...filter })
          const data = optedRows.find(r => String(r.owner_telegram_id) === String(filter.owner_telegram_id)
            && r.recipient_whatsapp_id === filter.recipient_whatsapp_id)
          return { data: data || null, error: null }
        },
      }
    }
    throw new Error('unexpected table ' + table)
  },
}
const normalizePhoneNumber = (input: unknown): string | null => {
  const phone = String(input ?? '').replace(/^whatsapp:/i, '')
  return /^\+\d{11,15}$/.test(phone) ? phone : null
}
const api: any = {}
runInNewContext(ts.transpileModule(readFileSync('lib/bot/handlers/reminder-optout.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: api,
  require: (name: string) => {
    if (name === '@/lib/supabase-admin') return { supabaseAdmin: db }
    if (name === './friend-reminders') return { normalizePhoneNumber }
    if (name === '@/lib/dashboard/owner-identity') return identity
    throw new Error('unexpected import ' + name)
  },
  console,
})

const recipient = 'whatsapp:+15555550101'
const adjacent = ['9007199254740992', '9007199254740993']
// RED on original: Number('9007199254740993') aliases its predecessor,
// so one owner's STOP row silently vanishes.
ownerRows = adjacent.map(owner_telegram_id => ({ owner_telegram_id }))
assert.equal(await api.suppressAllForRecipient(recipient), 2, 'STOP must suppress BOTH distinct 64-bit owners')
assert.deepEqual(inserts.map(r => String(r.owner_telegram_id)).sort(), adjacent, 'must store both exact BIGINT decimal IDs')
assert.ok(inserts.every(r => r.recipient_whatsapp_id === '+15555550101'))
console.log('PASS STOP keeps two adjacent persisted BIGINT owner IDs distinct')

// If an incoming Supabase result has already been rounded to an unsafe JS number,
// no safe owner authorization can be reconstructed from that value.
inserts.length = 0
ownerRows = [{ owner_telegram_id: Number(adjacent[1]) }]
const beforeReject = tableCalls
await assert.rejects(api.suppressAllForRecipient(recipient), /owner|unsafe|invalid|ambiguous/i,
  'ambiguous rounded owner must not be upserted as a different person')
assert.equal(inserts.length, 0)
assert.ok(tableCalls >= beforeReject)

// The send-path STOP gate must not query or send under rounded owner IDs.
const beforeUnsafeRead = tableCalls
await assert.rejects(api.isSuppressed(Number(adjacent[1]), recipient), /owner|unsafe|invalid|ambiguous/i)
assert.equal(tableCalls, beforeUnsafeRead, 'unsafe numeric owner denied before DB read')

// String owner identity is exact and can be compared to the opt-out record.
optedRows = [{ owner_telegram_id: adjacent[1], recipient_whatsapp_id: '+15555550101' }]
assert.equal(await api.isSuppressed(adjacent[1], recipient), true)
assert.equal(String(queried.at(-1)?.owner_telegram_id), adjacent[1])
assert.equal(await api.isSuppressed('42', recipient), false)
assert.equal(await api.isSuppressed(42, recipient), false)

// An invalid recipient at the send gate may NEVER mean "not opted out".
const beforeInvalid = tableCalls
await assert.rejects(api.isSuppressed(42, 'not-a-number'), /recipient|invalid/i)
assert.equal(tableCalls, beforeInvalid)
ownerRows = []
inserts.length = 0
assert.equal(await api.suppressAllForRecipient(recipient), 0)
assert.equal(inserts.length, 0)
console.log('REMINDER_OPTOUT_OWNER_PRECISION_OK')
