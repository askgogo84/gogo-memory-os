// Inert actual-module flight follow-up owner isolation regression.
// No Supabase, flight-provider, WhatsApp, browser, email, or network calls are made.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity'

const source = readFileSync('lib/agent/flight-track.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText
const now = new Date('2026-10-27T01:00:00.000Z')

function scenario(owner: unknown) {
  const queries: Array<{ table: string; column: string; value: unknown }> = []
  let networkAttempts = 0
  const db = {
    from(table: string) {
      if (table !== 'conversations') throw new Error('unexpected private table ' + table)
      const q: any = {
        select() { return q },
        eq(column: string, value: unknown) { queries.push({ table, column, value }); return q },
        order() { return q },
        limit() { return q },
        then(resolve: any, reject: any) {
          // This synthetic neighboring owner's private conversation must never
          // become available to another owner by a rounded numeric filter.
          return Promise.resolve({ data: [
            { content: 'Track VS 354', created_at: '2026-10-27T00:59:00.000Z' },
          ], error: null }).then(resolve, reject)
        },
      }
      return q
    },
  }
  const dependencies: Record<string, any> = {
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/bot/flight-codes': {
      requestedFlightCodes: (value: string) => /VS\s*354/i.test(value) ? ['VS354'] : [],
      normalizeNumericDates: (value: string) => value,
      icaoFlightCode: () => null,
      IATA_TO_ICAO: {},
    },
    '@/lib/services/travel-time': { ticketTimezone: () => null },
    './flight-leg-tracker': {
      legEvents: () => [], normalizeFlightNo: (value: unknown) => String(value).replace(/\s/g, ''),
      parseFlightData: () => null, statusFromWeb: () => null,
      trackingWindow: () => ({ from: 0, dep: 0 }),
    },
    '@/lib/web-search': { searchWebResults: async () => { throw Error('unexpected web search') } },
    '@/lib/bot/handlers/flight-status': { FLIGHT_TRACKER_DOMAINS: [] },
    '@/lib/services/cost-guard': {
      checkCostAllowance: async () => ({ allowed: false }),
      COST_ESTIMATES_PAISE: { web_search_basic: 0 },
      recordCostEvent: async () => {},
    },
    './watch-alert-delivery': { deliverWatchAlert: async () => { throw Error('unexpected alert') } },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
  }
  const exp: any = {}
  runInNewContext(compiled, {
    exports: exp,
    require: (name: string) => {
      if (!Object.prototype.hasOwnProperty.call(dependencies, name)) {
        throw Error('unmocked module import ' + name)
      }
      return dependencies[name]
    },
    Date, Intl, Number, String, Promise, Set, Map, Math, RegExp, URL,
    console, process: { env: {} },
    fetch: async () => { networkAttempts++; throw Error('unexpected live flight fetch') },
  }, { filename: 'inert-actual-flight-track.js', timeout: 15000 })
  return {
    run: () => exp.handleFlightFollowUp({
      telegramId: owner, text: 'Alert me once it lands', now, timezone: 'Asia/Kolkata',
    }) as Promise<string | null>,
    queries, networkAttempts: () => networkAttempts,
  }
}

// A rounded, malformed or ambiguous owner must fail closed BEFORE any private
// conversation read, even if another user has a valid flight reference.
for (const invalid of [
  '9007199254740992', '9007199254740993', 9007199254740993,
  '0042', '42.0', ' 42', '+42', '0', null, undefined,
]) {
  const f = scenario(invalid)
  const result = await f.run()
  assert.equal(result, null, 'untrusted owner must not resolve a private flight reference')
  assert.equal(f.queries.length, 0, 'untrusted owner must not query conversations: ' + String(invalid))
  assert.equal(f.networkAttempts(), 0, 'no remote lookup on invalid owner')
}

// Exact legitimate safe owners retain the existing follow-up behavior, but the
// service-role query must use the canonical persisted decimal string, not Number.
for (const owner of ['42', 42, '-42', '9007199254740991', '-9007199254740991']) {
  const f = scenario(owner)
  const result = await f.run()
  assert.equal(f.queries.length, 1, 'safe owner should read one owner-scoped history')
  assert.equal(f.queries[0].table, 'conversations')
  assert.equal(f.queries[0].column, 'telegram_id')
  assert.equal(f.queries[0].value, String(owner), 'private query must preserve exact owner text')
  assert.match(String(result), /haven't set a reminder|can't follow|couldn't find/i)
  assert.equal(f.networkAttempts(), 0, 'flight provider remains disabled in inert fixture')
}

console.log('Flight follow-up owner: actual worker under inert exact-owner/private-history mocks')
