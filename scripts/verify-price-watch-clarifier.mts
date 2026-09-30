import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import {
  parsePriceWatchCommand,
  parseOffersBasis,
  declaresStorageNotApplicable,
} from '../lib/agent/watch-command'

// ─────────────────────────────────────────────────────────────────────────────
// Pure-parser regressions for the exact live transcript (WhatsApp, 30 Sep 2026).
// ─────────────────────────────────────────────────────────────────────────────

// DEFECT 1: headphones have no storage variant, so the command must NOT flag storage as
// an evidenced (askable) slot, and must never carry a storage token forward.
const headphones = parsePriceWatchCommand(
  'Watch the price of the Sony WH-1000XM5 on amazon.in and tell me if it drops below 22000',
)
assert.ok(headphones, 'the price command must parse')
assert.equal(headphones.storage, null, 'no storage token may be invented for headphones')
assert.equal(headphones.storageEvidenced, false, 'headphones have no evidenced storage variant')
assert.equal(headphones.offers, 'unspecified', 'offers unspecified in the first message')
assert.equal(headphones.threshold, '22000')

// DEFECT 3: offers parsing. Exclusion must WIN even when the phrase names bank/card/offers.
assert.equal(parseOffersBasis('Listed selling price only.'), 'excluded')
assert.equal(parseOffersBasis('Listed selling price only, exclude bank and card offers.'), 'excluded')
assert.equal(parseOffersBasis('exclude bank and card offers'), 'excluded')
assert.equal(parseOffersBasis('no offers, list price'), 'excluded')
assert.equal(parseOffersBasis('include bank and card offers'), 'included')
assert.equal(parseOffersBasis('please count card offers toward it'), 'included')
assert.equal(parseOffersBasis('watch it'), null)

// N/A declaration for the storage slot.
assert.equal(declaresStorageNotApplicable('No storage variant - the WH-1000XM5 is headphones.'), true)
assert.equal(declaresStorageNotApplicable('it is headphones'), true)
assert.equal(declaresStorageNotApplicable('512GB'), false)

// A product WITH a real evidenced variant is still flagged (the question is still asked).
const phone = parsePriceWatchCommand(
  'Watch the price of the iPhone 15 Pro on amazon.in and tell me if it drops below 80000',
)
assert.ok(phone)
assert.equal(phone.storageEvidenced, true, 'a phone genuinely has storage variants')
assert.equal(phone.storage, null, 'no capacity stated yet, so it is an open slot')

console.log('price-watch parser regressions passed')

// ─────────────────────────────────────────────────────────────────────────────
// Full flow: load watch-command.ts in a VM with mocked deps, drive the real
// tryRunPriceWatchClarification through the exact transcript and its variants.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, any>
const stores: Record<string, any> = { agent_watchers: [], _id: 0, _wid: 0, tamperQuery: null }
let followState: any = null

function makeDb() {
  return {
    from(table: string) {
      const b: any = {
        _filters: [] as Array<[string, string, any]>,
        _count: false,
        _insert: null as Row | null,
        _update: null as Row | null,
        select(_cols?: any, opts?: any) { if (opts && opts.count) b._count = true; return b },
        eq(col: string, val: any) { b._filters.push(['eq', col, val]); return b },
        in(col: string, vals: any[]) { b._filters.push(['in', col, vals]); return b },
        order() { return b },
        limit() { return b },
        insert(row: Row) { b._insert = row; return b },
        update(row: Row) { b._update = row; return b },
        single: async () => resolveSingle(),
        maybeSingle: async () => resolveSingle(),
        then: (res: any, rej: any) => Promise.resolve(resolveTerminal()).then(res, rej),
      }
      function rows(): Row[] {
        let r: Row[] = stores[table] || []
        for (const [op, col, val] of b._filters) {
          if (op === 'eq') r = r.filter(x => String(x[col]) === String(val))
          if (op === 'in') r = r.filter(x => (val as any[]).map(String).includes(String(x[col])))
        }
        // newest first for read-back
        return [...r].sort((a, z) => String(z.created_at || '').localeCompare(String(a.created_at || '')))
      }
      function applyInsert(): Row {
        const row = { id: 'row' + (++stores._id), ...(b._insert as Row) }
        ;(stores[table] = stores[table] || []).push(row)
        return row
      }
      function resolveSingle() {
        if (b._insert) { const row = applyInsert(); return { data: { id: row.id, ...row }, error: null } }
        const r = rows(); return { data: r[0] || null, error: null }
      }
      function resolveTerminal() {
        if (b._insert) { const row = applyInsert(); return { data: [row], error: null } }
        if (b._update) { for (const x of rows()) Object.assign(x, b._update); return { data: rows(), error: null } }
        if (b._count) { return { count: rows().length, data: null, error: null } }
        // agent_permissions read used via maybeSingle only, so terminal reads return list
        return { data: rows(), error: null }
      }
      return b
    },
  }
}

const db = makeDb()

const followupMock = {
  saveFollowupState: async (_tg: number, kind: string, payload: Record<string, any>) => {
    followState = { type: 'followup_state', kind, payload, created_at: new Date().toISOString() }
  },
  getLatestFollowupState: async (_tg: number, kind: string) =>
    followState && followState.kind === kind ? followState : null,
  clearFollowupState: async () => { followState = null },
  isStrictlyFreshFollowupState: () => true,
  isFreshFollowupState: () => true,
}

function normalizeWebSearchWatcher(input: any) {
  const title = String(input?.title || '').trim().slice(0, 180)
  const query = String(input?.query || '').replace(/\s+/g, ' ').trim().slice(0, 500)
  if (!title || !query) return null
  const triggerKeywords = Array.isArray(input?.triggerKeywords) ? input.triggerKeywords.map(String) : []
  const delivery = ['app', 'whatsapp', 'both'].includes(String(input?.delivery)) ? input.delivery : 'both'
  const cadenceMinutes = Math.max(15, Math.min(1440, Math.floor(Number(input?.cadenceMinutes || 60))))
  return { title, query, triggerKeywords, delivery, cadenceMinutes, burstUntil: input?.burstUntil || null }
}

const watchersMock = {
  normalizeWebSearchWatcher,
  normalizeWebPageWatcher: () => null,
  normalizeProductStockWatcher: () => null,
  createWebSearchWatcher: async ({ telegramId, condition }: any) => {
    const query = stores.tamperQuery ?? condition.query
    const row = {
      id: 'w' + (++stores._wid),
      telegram_id: String(telegramId),
      type: 'web_search',
      condition_json: { ...condition, query },
      active: true,
      created_at: new Date(Date.now() + stores._wid).toISOString(),
    }
    stores.agent_watchers.push(row)
    return row
  },
  createWebPageWatcher: async () => ({}),
  createProductStockWatcher: async () => ({}),
  createInboxTriageWatcher: async () => ({}),
}

function loadWatchCommand() {
  const source = readFileSync(new URL('../lib/agent/watch-command.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mocks: Record<string, any> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    './typed-object-context': {
      latestTypedContext: async () => null,
      selectedTypedObject: () => null,
      rememberTypedObjects: async () => {},
    },
    '@/lib/services/cost-guard': {
      getCostBudget: async () => ({
        activeWebWatchersMax: 5, planCode: 'pro', baseWatcherCadenceMinutes: 60,
        burstHours: 0, maxWatcherCadenceMinutes: 1440,
      }),
    },
    '@/lib/services/google-gmail': { buildGmailConnectUrl: () => '' },
    '@/lib/bot/handlers/followup-state': followupMock,
    './actor': {}, './orchestrator': {},
    './watchers': watchersMock,
    './watch-cost-policy': {
      initialWatcherCadence: () => 15,
      isUrgentWatchRequest: () => false,
      watcherUpgradeMessage: () => 'upgrade your plan',
      adaptiveWatcherCadence: () => 60,
    },
  }
  const exportsObj: any = {}
  runInNewContext(code, { exports: exportsObj, require: (name: string) => mocks[name] || {}, process: { env: {} }, Buffer, URL, console })
  return exportsObj
}

const wc = loadWatchCommand()
const actor = { userId: 'u', legacyTelegramId: 42, whatsappId: '9', name: 'Gogo' }
const surface = 'whatsapp'

function reset() { stores.agent_watchers = []; stores._id = 0; stores._wid = 0; stores.tamperQuery = null; followState = null }
function latestWatcherQuery() { return String(stores.agent_watchers.at(-1)?.condition_json?.query || '') }

// ── The exact live transcript ────────────────────────────────────────────────
reset()
// Turn 1: the command. Exactly ONE clarification, and NOT about storage.
const t1 = await wc.tryRunPriceWatchClarification({
  actor, surface, text: 'Watch the price of the Sony WH-1000XM5 on amazon.in and tell me if it drops below 22000',
})
assert.ok(t1 && t1.status === 'paused', 'turn 1 asks a clarifying question')
assert.doesNotMatch(t1.text, /storage/i, 'DEFECT 1: no storage question for headphones')
assert.match(t1.text, /bank\/card offers|listed selling price/i, 'turn 1 asks only about the offers basis')
assert.equal(stores.agent_watchers.length, 0, 'no watch is created yet')

// Turn 2: the corrective reply. One slot answered, the other declared inapplicable.
// The watch must be created (no deadlock), N/A recorded, offers EXCLUDED, and the
// confirmation must state excluded — read back from the persisted record.
const t2 = await wc.tryRunPriceWatchClarification({
  actor, surface, text: 'Listed selling price only. No storage variant - the WH-1000XM5 is headphones.',
})
assert.ok(t2 && t2.status === 'completed', 'DEFECT 2: a correction must not deadlock — the watch is created')
assert.equal(stores.agent_watchers.length, 1, 'exactly one watcher persisted')
const q = latestWatcherQuery()
assert.doesNotMatch(q, /\d+\s*[GT]B/i, 'DEFECT 1/4: no invented storage token in the persisted query')
assert.doesNotMatch(q, /512/, 'the invented 512GB never appears anywhere in the query')
assert.match(q, /excluding bank\/card offers/i, 'DEFECT 3: persisted query stores offers EXCLUDED')
assert.match(t2.text, /excluding bank\/card offers/i, 'DEFECT 3: confirmation says excluded, matching the persisted record')
assert.doesNotMatch(t2.text, /including bank\/card offers/i, 'the confirmation must NOT invert the constraint')
assert.match(t2.text, /N\/A|no storage variant/i, 'storage recorded as N/A in the confirmation')
console.log('live transcript regression passed (defects 1, 2, 3)')

// ── At most ONE clarification question in the whole headphones flow ───────────
// (turn 1 asked once; turn 2 created without asking again.)

// ── Offers exclusion / inclusion mapping through the full flow ────────────────
reset()
await wc.tryRunPriceWatchClarification({ actor, surface, text: 'Watch the price of the Bose QC45 on amazon.in and tell me if it drops below 25000' })
const inc = await wc.tryRunPriceWatchClarification({ actor, surface, text: 'include bank and card offers' })
assert.ok(inc && inc.status === 'completed')
assert.match(latestWatcherQuery(), /including bank\/card offers/i, '"include bank and card offers" -> INCLUDED')
assert.match(inc.text, /including bank\/card offers/i, 'confirmation reflects INCLUDED from the persisted record')

// ── FIX 7/8: the confirmation is bound to the PERSISTED record, not a template. ──
// Tamper the persisted query so it disagrees with the user's explicit constraint;
// creation must be treated as FAILED (no success claim) and the watch deactivated.
reset()
stores.tamperQuery = 'the Sony WH-1000XM5 price in India below 22000 including bank/card offers'
await wc.tryRunPriceWatchClarification({ actor, surface, text: 'Watch the price of the Sony WH-1000XM5 on amazon.in and tell me if it drops below 22000' })
const mismatched = await wc.tryRunPriceWatchClarification({ actor, surface, text: 'exclude bank and card offers' })
assert.ok(mismatched && mismatched.status !== 'completed', 'a persisted/constraint mismatch is a FAILED creation')
assert.doesNotMatch(mismatched.text, /Persistent watch created/i, 'no success is announced on mismatch')
assert.equal(stores.agent_watchers[0].active, false, 'the mis-saved watch is deactivated')
console.log('persisted-record binding + mismatch regression passed (fixes 7, 8)')

// ── Partial answer: answer one of two open slots, retain it, re-ask only the other. ──
reset()
const p1 = await wc.tryRunPriceWatchClarification({
  actor, surface, text: 'Watch the price of the iPhone 15 Pro on amazon.in and tell me if it drops below 80000',
})
assert.ok(p1 && p1.status === 'paused', 'evidenced product still asks a question')
assert.match(p1.text, /storage/i, 'a phone WITH a real variant is asked about storage')
const p2 = await wc.tryRunPriceWatchClarification({ actor, surface, text: '512GB' })
assert.ok(p2 && p2.status === 'paused', 'answering one of two slots re-asks the remaining one')
assert.doesNotMatch(p2.text, /which storage/i, 'the answered storage slot is not re-asked')
assert.match(p2.text, /bank\/card offers|listed selling price/i, 'only the unanswered offers slot is re-asked')
assert.equal(followState.payload.storage, '512GB', 'the answered storage value is retained in state')
assert.equal(stores.agent_watchers.length, 0, 'no watch created while a slot is still open')
console.log('partial-answer retention + single re-ask regression passed (fix 3)')

console.log('✅ price-watch clarifier + confirmation checks passed')
