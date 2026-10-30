// TEST ONLY — synthetic email forwarding activation trust-boundary regression.
// This fixture executes the shipped processInboundEmail function, with the real MIME
// parser and a mock owner-bound database. No production, network, provider, or user data.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { parseMail, previewText, gmailForwardingConfirmation } from '../lib/email/mime.ts'

const source = readFileSync(new URL('../lib/email/inbound.ts', import.meta.url), 'utf8')
const parsed = ts.createSourceFile('inbound.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const declaration = parsed.statements.find(stmt =>
  ts.isFunctionDeclaration(stmt) && stmt.name?.text === 'processInboundEmail')
assert.ok(declaration && ts.isFunctionDeclaration(declaration), 'shippped processInboundEmail must exist')

// Transpile only the *actual shipped function*, not a rewritten test approximation.
// External functions are substituted with inert adapters; the real MIME reader runs.
const functionSource = declaration.getText(parsed).replace(/^export\s+/, '')
const compiled = ts.transpileModule(functionSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
const makeHandler = new Function('deps',
  '"use strict";const {createHash,supabaseAdmin,aliasFromAddress,ownerOfAlias,parseMail,previewText,' +
  'gmailForwardingConfirmation,scoreEmail,loadRules,threadKeyOf,clean,notify,FORWARDING_ON_TEXT,' +
  'PUSH_SCORE,MAX_PUSHES_PER_DAY}=deps;\n' + compiled + '\nreturn processInboundEmail;'
) as (deps: Record<string, unknown>) => (input: {
  to: string; from: string; raw: string; now: number
}) => Promise<{ status: string; pushed?: boolean }>

const alias = 'owner-alias@in.example.test'
const activationNotice = 'SYNTHETIC_FORWARDING_ON_NOTICE'
const timestamp = Date.parse('2026-10-30T03:25:00.000Z')

type Fixture = {
  name: string
  visibleTo: string
  untrustedHeader?: string
  confirmedAt?: string | null
}

async function runFixture(f: Fixture) {
  const updates: Array<{ table: string; payload: Record<string, unknown>; ownerKey?: string }> = []
  const notifications: Array<{ key: string; message: string }> = []
  const writes: string[] = []
  const db = {
    from(table: string) {
      return {
        upsert(row: Record<string, unknown>) {
          assert.equal(table, 'inbound_emails', 'unexpected upsert table')
          assert.equal(row.telegram_id, 7001, 'all fixtures must remain mock-owner bound')
          writes.push(table)
          return { select: async () => ({ data: [{ id: 'synthetic-email-id' }], error: null }) }
        },
        update(payload: Record<string, unknown>) {
          assert.equal(table, 'email_aliases', 'unexpected update table')
          return {
            eq: async (field: string, value: string) => {
              assert.equal(field, 'alias')
              assert.equal(value, alias)
              updates.push({ table, payload, ownerKey: value })
              return { error: null }
            },
          }
        },
        delete() {
          assert.equal(table, 'inbound_emails', 'unexpected delete table')
          return {
            eq: (field: string, value: number) => {
              assert.equal(field, 'telegram_id')
              assert.equal(value, 7001)
              return {
                lt: async () => ({ error: null }),
              }
            },
          }
        },
      }
    },
  }
  const handler = makeHandler({
    createHash,
    supabaseAdmin: db,
    aliasFromAddress: (value: unknown) => String(value || '').trim().toLowerCase() === alias ? alias : null,
    ownerOfAlias: async (savedAlias: string) => {
      assert.equal(savedAlias, alias)
      return { telegramId: 7001, confirmedAt: f.confirmedAt || null }
    },
    parseMail,
    previewText,
    gmailForwardingConfirmation,
    scoreEmail: () => ({ category: 'update', score: 0.05, picked: false }),
    loadRules: async () => [],
    threadKeyOf: () => 'fixture-thread',
    clean: (value: unknown, max = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max),
    notify: async (_owner: number, key: string, message: string) => {
      notifications.push({ key, message })
      return false
    },
    FORWARDING_ON_TEXT: activationNotice,
    PUSH_SCORE: 0.8,
    MAX_PUSHES_PER_DAY: 6,
  })
  const raw = [
    'From: Unverified Sender <outsider@example.test>',
    'To: ' + f.visibleTo,
    'Subject: Ordinary synthetic note',
    'Message-ID: <fixture-' + f.name.replace(/[^a-z0-9]/gi, '-') + '@example.test>',
    ...(f.untrustedHeader ? [f.untrustedHeader] : []),
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Hello; this is synthetic ordinary mail, not verified Gmail forwarding evidence.',
  ].join('\r\n')
  const result = await handler({ to: alias, from: 'outsider@example.test', raw, now: timestamp })
  assert.equal(result.status, 'stored')
  assert.equal(result.pushed, false)
  assert.deepEqual(writes, ['inbound_emails'])
  assert.equal(updates.length, 1)
  return {
    activated: Object.prototype.hasOwnProperty.call(updates[0].payload, 'forwarding_confirmed_at'),
    notification: notifications.some(n => n.message === activationNotice),
    changes: updates[0].payload,
  }
}

let passed = 0
let failed = 0
async function check(label: string, fn: () => Promise<void>) {
  try {
    await fn()
    passed++
    console.log('PASS ' + label)
  } catch (error) {
    failed++
    console.error('FAIL ' + label + ': ' + (error instanceof Error ? error.message : String(error)))
  }
}

// Legitimate control: a direct inbound message delivered to the alias must be
// saved, but must never by itself imply verified Gmail forwarding is enabled.
await check('CONTROL: direct alias delivery stays unconfirmed', async () => {
  const r = await runFixture({ name: 'direct-alias', visibleTo: alias })
  assert.equal(r.activated, false)
  assert.equal(r.notification, false)
})

// Repeated ordinary delivery must never rewrite an already confirmed state.
await check('CONTROL: existing confirmed alias produces no new activation notice', async () => {
  const r = await runFixture({
    name: 'already-confirmed', visibleTo: alias, confirmedAt: '2026-10-01T00:00:00Z',
    untrustedHeader: 'X-Forwarded-To: ' + alias,
  })
  assert.equal(r.activated, false)
  assert.equal(r.notification, false)
})

const negatives = [
  {
    name: 'forged-forwarded-to', visibleTo: alias,
    untrustedHeader: 'X-Forwarded-To: ' + alias,
    label: 'untrusted X-Forwarded-To',
  },
  {
    name: 'forged-forwarded-for', visibleTo: alias,
    untrustedHeader: 'X-Forwarded-For: outsider@example.test',
    label: 'untrusted X-Forwarded-For',
  },
  {
    name: 'bcc-visible-recipient', visibleTo: 'other-recipient@example.test',
    label: 'mismatched envelope and visible To',
  },
]
for (const f of negatives) {
  // The same synthetic run is inspected for both durable state and false user notice.
  // Neither must be trusted solely because unverified RFC822 headers claim forwarding.
  const observed = await runFixture(f)
  await check('SAFETY: ' + f.label + ' cannot confirm forwarding', async () =>
    assert.equal(observed.activated, false, 'unverified mail must not set forwarding_confirmed_at'))
  await check('SAFETY: ' + f.label + ' cannot send forwarding-enabled notice', async () =>
    assert.equal(observed.notification, false, 'unverified mail must not claim forwarding is on'))
}
console.log('Forwarding activation evidence fixture: ' + passed + ' pass / ' + failed + ' fail')
if (failed) process.exitCode = 1
