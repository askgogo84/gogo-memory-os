// Inert original-function regression for inbound forwarded-email notification outcomes.
// No real Supabase, Resend, Twilio, WhatsApp, secrets or customer data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/email/inbound.ts', 'utf8')
const begin = source.indexOf('async function notify(')
const end = source.indexOf('\nexport type InboundResult', begin)
assert.ok(begin !== -1 && end > begin, 'find the original inbound notification function')
const original = source.slice(begin, end)
const compiled = ts.transpileModule(
  original + '\n;(globalThis as any).__inboundNotify = notify;',
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText

type Status = 'provider_accepted' | 'skipped' | 'deferred' | 'suppressed' | 'failed' | 'persistence_failed' | 'outcome_unknown'
function harness(status: Status, opts: { noPhone?: boolean; throwGateway?: boolean } = {}) {
  const lookedUp: Array<{ table: string; field: string; id: unknown }> = []
  const cards: Array<{ telegram_id: number; role: string; content: string }> = []
  const notifications: Array<{ key: string; owner: number; channel: string; source: string }> = []
  let outboundCalls = 0
  const supabaseAdmin = {
    from(table: string) {
      if (table === 'users') {
        return {
          select(columns: string) {
            assert.equal(columns, 'whatsapp_id')
            return {
              eq(field: string, id: unknown) {
                lookedUp.push({ table, field, id })
                return { async maybeSingle() { return { data: opts.noPhone ? null : { whatsapp_id: '+15550000042' }, error: null } } }
              },
            }
          },
        }
      }
      if (table === 'conversations') {
        return {
          insert(card: { telegram_id: number; role: string; content: string }) {
            cards.push(card)
            return Promise.resolve({ error: null })
          },
        }
      }
      throw new Error('unexpected DB table: ' + table)
    },
  }
  const scope: any = {
    supabaseAdmin,
    deliverNotification: async (p: { key: string; owner: number; channel: string; source: string }) => {
      notifications.push({ key: p.key, owner: p.owner, channel: p.channel, source: p.source })
      if (opts.throwGateway) throw new Error('synthetic_delivery_gateway_error')
      return status
    },
    sendWhatsApp: async () => { outboundCalls++; throw new Error('NO REAL SEND') },
    console: { error: () => {} },
  }
  runInNewContext(compiled, scope, { timeout: 2000 })
  const notify = scope.__inboundNotify as (id: number, key: string, text: string) => Promise<boolean>
  assert.equal(typeof notify, 'function')
  return { notify, lookedUp, cards, notifications, get outboundCalls() { return outboundCalls } }
}

const cardText = 'Synthetic urgent email; action requested'
const key = 'email-urgent/42/test-id'
for (const status of [
  'provider_accepted', 'skipped', 'deferred', 'suppressed', 'failed', 'persistence_failed', 'outcome_unknown',
] as Status[]) {
  const h = harness(status)
  const pushed = await h.notify(42, key, cardText)
  const accepted = status === 'provider_accepted'
  assert.equal(pushed, accepted, status + ' must never imply delivered/accepted when not accepted')
  assert.deepEqual(h.lookedUp, [{ table: 'users', field: 'telegram_id', id: 42 }])
  assert.deepEqual(h.notifications, [{ key, owner: 42, channel: 'whatsapp', source: 'watch_alert' }])
  assert.equal(h.cards.length, accepted ? 1 : 0, status + ' must not create phantom WhatsApp cards')
  if (accepted) assert.deepEqual(JSON.parse(JSON.stringify(h.cards[0])), { telegram_id: 42, role: 'assistant', content: cardText })
  assert.equal(h.outboundCalls, 0, 'a gateway result is simulated; never contact a provider')
  console.log('PASS original inbound notify gateway status ' + status)
}

const missing = harness('provider_accepted', { noPhone: true })
assert.equal(await missing.notify(42, key, cardText), false)
assert.equal(missing.notifications.length, 0, 'no recipient: do not ask gateway to send')
assert.equal(missing.cards.length, 0)
console.log('PASS missing destination fails closed')

const thrown = harness('provider_accepted', { throwGateway: true })
assert.equal(await thrown.notify(42, key, cardText), false)
assert.equal(thrown.notifications.length, 1)
assert.equal(thrown.cards.length, 0)
assert.equal(thrown.outboundCalls, 0)
console.log('PASS gateway exception is not claimed as a send')

// Verify caller truthfulness: only the boolean returned by the original notify()
// is allowed to mark received mail as notified; no fallback send or retry here.
assert.match(source, /const pushed = await notify\(telegramId, `email-urgent\//)
assert.match(source, /if \(pushed\) await supabaseAdmin\.from\('inbound_emails'\)\.update\(\{ notified_at: at \}\)/)
console.log('inbound alert receipt truthfulness: all synthetic original-function cases passed')
