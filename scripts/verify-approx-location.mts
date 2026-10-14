import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
// 14 Oct: location is the person's opt-in. The browser keeps a rounded position and sends it only with a
// message; nothing is stored on the server; for now it is the default place for weather.
// Run: npx tsx scripts/verify-approx-location.mts
const compile = (file: string) => ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function load(file: string, mocks: Record<string, any>, fallback: any = {}) {
  const exports: any = {}
  vm.runInNewContext(compile(file), { exports, module: { exports }, require: (name: string) => mocks[name] || fallback, URL, console, Date, Number, JSON, Math, String, Object, Array })
  return exports
}
const loc = load('lib/dashboard/approx-location.ts', {})

// 1. Rounding and validation
const same = (a: any, b: any, m?: string) => assert.equal(JSON.stringify(a), JSON.stringify(b), m) // objects built inside vm contexts have another prototype
same(loc.parseApproxLocation({ lat: 12.971598, lon: 77.594566 }), { lat: 12.97, lon: 77.59 })
same(loc.parseApproxLocation({ lat: '12.9716', lon: '77.5946' }), { lat: 12.97, lon: 77.59 })
for (const bad of [null, undefined, 'x', {}, { lat: 'a', lon: 1 }, { lat: 91, lon: 0 }, { lat: 0, lon: 181 }, { lat: NaN, lon: 1 }, { lat: Infinity, lon: 1 }]) assert.equal(loc.parseApproxLocation(bad), null, JSON.stringify(bad))
assert.equal(loc.locationQuery({ lat: 12.97, lon: 77.59 }), '12.97,77.59')

// 2. The saved choice
assert.equal(loc.parseLocationPreference(null).status, 'ask')
assert.equal(loc.parseLocationPreference('not json').status, 'ask')
assert.equal(loc.parseLocationPreference(JSON.stringify({ status: 'off' })).status, 'off')
assert.equal(loc.parseLocationPreference(JSON.stringify({ status: 'on', lat: 500, lon: 1 })).status, 'ask', 'an invalid saved position asks again')
const on = loc.parseLocationPreference(JSON.stringify({ status: 'on', lat: 12.9716, lon: 77.5946, label: 'Bengaluru', at: 1000 }))
same([on.status, on.lat, on.lon, on.label], ['on', 12.97, 77.59, 'Bengaluru'], 'a saved position is re-rounded on read')
assert.equal(loc.locationTag(on), 'Bengaluru (approx.)')
assert.equal(loc.locationTag({ status: 'off' }), '')
assert.equal(loc.locationIsStale(on, 1000 + loc.LOCATION_MAX_AGE_MS + 1), true)
assert.equal(loc.locationIsStale(on, 2000), false)
assert.equal(loc.locationIsStale({ status: 'off' }, 1e12), false)

// 3. Weather: a place in the sentence wins, then the allowed location, then Bangalore as before
let asked: string[] = []
const det = load('lib/bot/handlers/deterministic.ts', { '@/lib/services/weather': { fetchWeatherForecast: async (place: string) => { asked.push(place); return { location: { name: place } } }, formatCurrentWeather: (f: any) => 'now ' + f.location.name, formatTomorrowWeather: (f: any) => 'tomorrow ' + f.location.name } })
await det.buildDeterministicWeatherReply('what is the weather', '12.97,77.59')
await det.buildDeterministicWeatherReply('weather in Mumbai today', '12.97,77.59')
await det.buildDeterministicWeatherReply('will it rain tomorrow', '12.97,77.59')
await det.buildDeterministicWeatherReply('what is the weather')
await det.buildDeterministicWeatherReply('what is the weather', null)
same(asked, ['12.97,77.59', 'Mumbai', '12.97,77.59', 'Bangalore', 'Bangalore'])

// 4. The label endpoint: same origin, signed in, valid position, rounded, nothing stored
const routeSource = fs.readFileSync('app/api/dashboard/location/route.ts', 'utf8')
assert.ok(!/supabase|insert\(|upsert\(|console\.(log|info)/.test(routeSource), 'the position must not be stored or logged')
let weatherQuery = ''
let signedIn = true
const locRoute = load('app/api/dashboard/location/route.ts', {
  'next/server': { NextResponse: { json: (body: any, options?: any) => ({ body, status: options?.status || 200 }) } },
  '@/lib/dashboard/session': { getSession: async () => (signedIn ? { telegramId: '1' } : null) },
  '@/lib/dashboard/approx-location': loc,
  '@/lib/services/weather': { fetchWeatherForecast: async (place: string) => { weatherQuery = place; return { location: { name: 'Bengaluru' } } } },
})
const call = (body: any, origin: string | null = 'https://app.askgogo.in') => locRoute.POST({ headers: { get: () => origin }, nextUrl: { host: 'app.askgogo.in' }, json: async () => body })
assert.equal((await call({ lat: 12.9716, lon: 77.5946 }, null)).status, 403)
assert.equal((await call({ lat: 12.9716, lon: 77.5946 }, 'https://evil.example')).status, 403)
signedIn = false
assert.equal((await call({ lat: 12.9716, lon: 77.5946 })).status, 401)
signedIn = true
assert.equal((await call({ lat: 200, lon: 77 })).status, 400)
const ok = await call({ lat: 12.971598, lon: 77.594566 })
same(ok.body, { lat: 12.97, lon: 77.59, label: 'Bengaluru' })
assert.equal(weatherQuery, '12.97,77.59', 'only the rounded position leaves the server')

// 5. The chat route passes a valid rounded position on, and nothing when it is missing or invalid
let seen: any[] = []
const db: any = { from(table: string) { const q: any = { select() { return q }, eq() { return q }, maybeSingle() { return q }, insert() { return q }, then(resolve: any, reject: any) { return Promise.resolve({ data: table === 'users' ? { telegram_id: 101, whatsapp_id: 'fixture', name: 'Fixture' } : null, error: null }).then(resolve, reject) } }; return q } }
const noops = new Proxy({}, { get: () => async () => null })
const chat = load('app/api/dashboard/chat/route.ts', {
  crypto: { randomUUID: () => 'fixture-event' },
  'next/server': { NextResponse: { json: (body: any, options?: any) => ({ body, status: options?.status || 200 }) } },
  '@/lib/supabase-admin': { supabaseAdmin: db },
  '@/lib/dashboard/session': { getSession: async () => ({ telegramId: '101' }) },
  '@/lib/agent/actor': { resolveAgentActor: async () => ({ legacyTelegramId: 101 }) },
  '@/lib/bot/handlers/friend-reminders': { detectFriendReminder: () => null, isFriendReminderFollowupCandidate: () => false },
  '@/lib/agent/watch-command': { tryGetWatcherStatusFromCommand: async () => null, tryRunPriceWatchClarification: async () => null, tryStopWatcherFromCommand: async () => null, tryUpdateWebWatchFromCommand: async () => null, tryCreateWebWatchFromCommand: async () => null, tryCreateInboxTriageWatchFromCommand: async () => null },
  '@/lib/dashboard/day-chat': { detectDashboardDayIntent: () => null },
  '@/lib/agent/read-only-schedule': { detectReadOnlyScheduleRequest: () => null },
  '@/lib/agent/shadow-brain': { observeShadowBrainTurn: async () => ({ jev: null }) },
  '@/lib/agent/jev-router': { isGroundedReminderCommand: () => false, jevClarificationReply: () => null },
  '@/lib/dashboard/approx-location': loc,
  '@/lib/agent/general-planner': { tryRunGeneralPlan: async () => null },
  '@/lib/bot/process-message': { processIncomingMessage: async (params: any) => { seen.push(params.approxLocation); return { text: 'ok', handledBy: 'fixture' } } },
}, noops)
const post = (body: any) => chat.POST({ headers: { get: () => 'https://app.askgogo.in' }, nextUrl: { host: 'app.askgogo.in' }, json: async () => body })
await post({ text: 'what is the weather', location: { lat: 12.971598, lon: 77.594566 } })
await post({ text: 'what is the weather' })
await post({ text: 'what is the weather', location: { lat: 999, lon: 1 } })
same(seen, [{ lat: 12.97, lon: 77.59 }, null, null])

// 6. The chat page: opt-in card, consent kept in the browser, position sent only when on, easy to turn off
const ui = fs.readFileSync('components/dashboard/gogo-chat.tsx', 'utf8')
for (const needle of ['Get more useful local help', 'Not now', 'Enable location', 'Turn off', 'LOCATION_STORAGE_KEY', "loc.status==='on'?{text:next,location:{lat:loc.lat,lon:loc.lon}}:{text:next}", 'navigator.geolocation']) assert.ok(ui.includes(needle), needle)
assert.ok(!/enableLocation\(\)\s*\}\s*,\s*\[\s*\]/.test(ui), 'the page must never ask for permission on its own')
console.log('verify-approx-location: ok')
