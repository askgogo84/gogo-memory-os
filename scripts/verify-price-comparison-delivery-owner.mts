// Conditional P1 privacy regression. Runs the ACTUAL transpiled delivery boundary with inert
// users DB, ledger, price-comparison and Twilio stubs. Never sends or accesses real accounts.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

type Fixture = {
  ledgerCalls: number
  userReads: number
  comparisonReads: number
  sends: Array<{ to: string; message: string }>
  publications: Array<{ owner: string; runId: string }>
}
const raw = readFileSync(new URL('../lib/commerce/comparison-delivery.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const baseTask = {
  id: 'synthetic-comparison-1', source: 'whatsapp', status: 'paused', title: 'Synthetic product',
  updated_at: '2026-10-27T08:00:00.000Z', metadata_json: { request: 'synthetic', subject: 'Synthetic item', providers: [{ provider: 'amazon', status: 'failed' }] },
}
const baseActor = { userId: 'owner-a', legacyTelegramId: 42, whatsappId: 'whatsapp:+15550000042', name: 'Fixture' }
function fixture(options: {
  storedOwner?: string | number; storedUuid?: string; storedPhone?: string
  forceForeignRow?: boolean; beforeReady?: () => void; beforeSend?: () => void
  source?: string; userError?: boolean
} = {}) {
  const row = { id: options.storedUuid ?? 'owner-a', telegram_id: options.storedOwner ?? '42', whatsapp_id: options.storedPhone ?? 'whatsapp:+15550000042' }
  const events: Fixture = { ledgerCalls: 0, userReads: 0, comparisonReads: 0, sends: [], publications: [] }
  const task = { ...baseTask, source: options.source || 'whatsapp' }
  const db = {
    from(table: string) {
      const filters: Array<[string,string]> = []
      const q: any = {
        select() { return q },
        eq(key: string, value: unknown) { filters.push([key,String(value)]); return q },
        is() { return q },
        update() { return q },
        insert() { return q },
        async maybeSingle() {
          if (table === 'users') {
            events.userReads++
            if (options.userError) return { data: null, error: { message: 'synthetic DB outage' } }
            const valid = filters.every(([key,val]) => String((row as any)[key]) === val)
            return { data: valid || options.forceForeignRow ? {...row} : null, error: null }
          }
          if (table === 'agent_runs') return { data: { status: 'paused', source: 'whatsapp' }, error: null }
          throw Error('unlisted private table: '+table)
        },
      }
      return q
    },
    async rpc(name: string, args: any) {
      assert.equal(name, 'publish_web_comparison_result')
      events.publications.push({owner: String(args.p_owner),runId: String(args.p_run_id)})
      return { data: true, error: null }
    },
  }
  const dependencies: Record<string,unknown> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/services/notification-delivery': { deliverNotification: async (props: any) => {
      events.ledgerCalls++
      await props.prepare()
      options.beforeReady?.()
      if (!(await props.ready())) return 'suppressed'
      options.beforeSend?.()
      try {
        await props.send('synthetic-delivery-id')
        return 'provider_accepted'
      } catch { return 'outcome_unknown' } // unsafe to retry after uncertain failure
    } },
    '@/lib/whatsapp': { sendWhatsApp: async (to: string, message: string) => {
      events.sends.push({to,message}); return { sid: 'synthetic-provider-id' }
    } },
    './comparison-model': { comparisonState: () => 'paused', comparisonWhatsAppSummary: () => 'PRIVATE SYNTHETIC COMPARISON' },
    './price-comparison': {
      comparisonWebFallback: async () => null,
      readPriceComparison: async (owner: string, id: string) => {
        events.comparisonReads++
        return owner === '42' && id === task.id ? task : null
      },
    },
  }
  const exports: any = {}
  runInNewContext(compiled, {
    exports, process: { env: {} }, console, Date, Error, Number, String,
    require(name: string) {
      if (name in dependencies) return dependencies[name]
      throw Error('unlisted dependency: ' + name)
    },
  })
  return { events, row, task, send: (actor: any = baseActor) => exports.deliverCompletedComparison(task, actor, Date.now() + 30_000) as Promise<string> }
}

const unsafe = fixture()
assert.equal(await unsafe.send({ ...baseActor, legacyTelegramId: 9007199254740992 }), 'skipped', 'unsafe numeric owner must fail closed')
assert.equal(unsafe.events.ledgerCalls, 0, 'unsafe owner cannot claim outbound ledger')
assert.equal(unsafe.events.comparisonReads, 0, 'unsafe owner cannot read private comparisons')

const foreignUuid = fixture()
assert.equal(await foreignUuid.send({ ...baseActor, userId: 'foreign-uuid' }), 'skipped', 'wrong actor UUID cannot deliver')
assert.equal(foreignUuid.events.ledgerCalls, 0, 'no ledger claim for foreign UUID')

const foreignOwner = fixture({ storedOwner: '43' })
assert.equal(await foreignOwner.send(), 'skipped', 'wrong persisted telegram owner cannot deliver')
assert.equal(foreignOwner.events.ledgerCalls, 0)

const badProjection = fixture({ storedOwner: '43', storedUuid: 'foreign-uuid', forceForeignRow: true })
assert.equal(await badProjection.send(), 'skipped', 'do not trust an incorrectly returned SQL row')
assert.equal(badProjection.events.ledgerCalls, 0)

const staleRecipient = fixture({ storedPhone: 'whatsapp:+15550000043' })
assert.equal(await staleRecipient.send(), 'skipped', 'mismatched actor recipient cannot deliver')
assert.equal(staleRecipient.events.ledgerCalls, 0)

const lateRecipient = fixture({ beforeReady: () => { lateRecipient.row.whatsapp_id = 'whatsapp:+15550000043' } })
assert.equal(await lateRecipient.send(), 'suppressed', 'phone reassigned after ledger prepare must block send')
assert.equal(lateRecipient.events.sends.length, 0)

const sendRace = fixture({ beforeSend: () => { sendRace.row.whatsapp_id = 'whatsapp:+15550000043' } })
assert.equal(await sendRace.send(), 'outcome_unknown', 'unexpected pre-send changed owner must not be retried blindly')
assert.equal(sendRace.events.sends.length, 0, 'changed recipient cannot receive private report')

const healthy = fixture()
assert.equal(await healthy.send(), 'provider_accepted', 'safe actor still delivers normally')
assert.deepEqual(healthy.events.sends, [{ to: baseActor.whatsappId, message: 'PRIVATE SYNTHETIC COMPARISON' }])
assert.ok(healthy.events.userReads >= 2, 'owner must be checked initially and at send boundary')

const web = fixture({ source: 'web' })
assert.equal(await web.send(), 'history_published', 'verified owner may publish private web history')
assert.deepEqual(web.events.publications, [{owner:'42',runId:baseTask.id}])
assert.equal(web.events.sends.length, 0, 'web comparisons never send WhatsApp')

const webForeign = fixture({source: 'web'})
assert.equal(await webForeign.send({...baseActor,userId:'foreign-uuid'}), 'skipped')
assert.equal(webForeign.events.publications.length, 0, 'wrong owner cannot publish web history')

console.log('Comparison delivery exact owner/recipient boundary: 10 inert scenarios passed')
