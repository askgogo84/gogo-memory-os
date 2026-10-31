// P1 conditional, inert source-level booking closure owner isolation. No providers or real tenants.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import * as ts from 'typescript'

const source = readFileSync(new URL('../lib/agent/booking-closure.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('booking-closure.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const actualFunction = (name: string) =>
  ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
const actorNode = actualFunction('actorFor')
assert.ok(actorNode, 'real booking closure actorFor must exist')
const helperNode = actualFunction('exactBookingOwnerId')
const actualTs = [
  helperNode?.getText(ast) || '',
  actorNode.getText(ast),
  'globalThis.__bookingActorFor = actorFor',
].join('\n')
const actualJs = ts.transpileModule(actualTs, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText

type Row = { id?: string; telegram_id?: string | number; whatsapp_id?: string; name?: string; timezone?: string }
const db: {
  predicates: Array<{column: string; value: unknown}>
  response: { data: Row | null; error: {message: string} | null }
} = {
  predicates: [],
  response: { data: null, error: null },
}
const supabaseAdmin = {
  from(table: string) {
    assert.equal(table, 'users', 'private actor resolver may only look up a user')
    return {
      select(columns: string) {
        assert.match(columns, /telegram_id/)
        return {
          eq(column: string, value: unknown) {
            db.predicates.push({ column, value })
            return { maybeSingle: async () => db.response }
          },
        }
      },
    }
  },
}
const sandbox: Record<string, unknown> = { supabaseAdmin }
runInNewContext(actualJs, sandbox, { filename: 'actual-booking-closure-actor.js' })
const actorFor = sandbox.__bookingActorFor as (owner: number) =>
  Promise<{actor: { userId: string; legacyTelegramId: number; whatsappId: string; name: string }; timezone: string}>
assert.equal(typeof actorFor, 'function')

const user = (owner: string | number, uuid = 'synthetic-account-A'): Row => ({
  id: uuid, telegram_id: owner, whatsapp_id: 'whatsapp:+15550000042',
  name: 'Synthetic A', timezone: 'Asia/Kolkata',
})
function mock(row: Row | null, error: {message: string} | null = null) {
  db.predicates = []
  db.response = { data: row, error }
}

const ownerA = Number('9007199254740992')
const ownerB = Number('9007199254740993')
assert.equal(ownerA, ownerB, 'test needs an actual IEEE-754 aliasing pair')
mock(user('9007199254740992', 'neighbor-account'))
await assert.rejects(
  () => actorFor(ownerB),
  /booking_actor_unsafe_owner/,
  'rounded 64-bit private owner must never select a neighboring Gmail/browser account',
)
assert.equal(db.predicates.length, 0, 'unsafe owner must fail before a privileged users lookup')

for (const bad of [0, 1.25, Number.POSITIVE_INFINITY, Number.NaN, -Number('9007199254740993')]) {
  mock(user(42))
  await assert.rejects(() => actorFor(bad), /booking_actor_unsafe_owner/,
    'invalid/rounded owner must fail closed before reading private account credentials')
  assert.equal(db.predicates.length, 0)
}

mock(user('42'))
const valid = await actorFor(42)
assert.equal(valid.actor.userId, 'synthetic-account-A')
assert.equal(valid.actor.legacyTelegramId, 42)
assert.equal(valid.actor.whatsappId, 'whatsapp:+15550000042')
assert.equal(valid.timezone, 'Asia/Kolkata')
assert.deepEqual(db.predicates, [{ column: 'telegram_id', value: '42' }],
  'service-role lookup must compare the exact safe decimal owner as a string')

mock(user('-42'))
const legacy = await actorFor(-42)
assert.equal(legacy.actor.legacyTelegramId, -42, 'valid negative legacy identities remain supported')
assert.deepEqual(db.predicates, [{ column: 'telegram_id', value: '-42' }])

mock(user('43', 'different-account'))
await assert.rejects(() => actorFor(42), /booking_actor_owner_mismatch/,
  'mismatched returned users row must not become a private browser/Gmail actor')

mock(user('0042', 'legacy-malformed-account'))
await assert.rejects(() => actorFor(42), /booking_actor_owner_mismatch/,
  'ambiguous persisted owner IDs must not gain authority')

mock(user(9007199254740992, 'rounded-db-account'))
await assert.rejects(() => actorFor(42), /booking_actor_owner_mismatch/,
  'unsafe rounded persisted owner must be rejected before private Gmail/WhatsApp use')

mock(null)
await assert.rejects(() => actorFor(42), /booking_actor_missing/,
  'missing owner must fail closed')
mock(user(42), { message: 'inert DB outage' })
await assert.rejects(() => actorFor(42), /booking_actor_missing/,
  'failed owner lookup must fail closed')

assert.ok(
  source.indexOf('actorFor(params.telegramId)') > 0
  && source.indexOf('actorFor(params.telegramId)') < source.indexOf('findGmailTicketEvidence(actor,'),
  'booking closure must bind actor before private Gmail ticket read',
)
console.log('Booking closure owner: actual actor resolver with inert 64-bit neighbor/row-mismatch controls PASS')
