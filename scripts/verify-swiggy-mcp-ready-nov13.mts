// Swiggy MCP readiness (13 Nov 2026, owner "approve swiggy mock"): attribution on every Swiggy result, rotating
// refresh tokens kept and used once, Dineout read tools only. Mock data only; nothing here calls Swiggy.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {poweredBy, withSwiggyAttribution} from '../lib/commerce/swiggy-attribution.ts'
import * as oauth from '../lib/commerce/oauth.ts'
import {readDineoutRestaurants, readDineoutSlots} from '../lib/commerce/swiggy-read.ts'

let checks = 0
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }

// 1. Attribution: exact phrases, own line after the heading, idempotent.
eq(poweredBy('food'), 'Powered by Swiggy', 'food phrase')
eq(poweredBy('instamart'), 'Powered by Instamart', 'instamart phrase')
eq(poweredBy('dineout'), 'Powered by Dineout', 'dineout phrase')
eq(withSwiggyAttribution('Toit, Indiranagar\n8:00 pm, 2 people', 'dineout'), 'Toit, Indiranagar\nPowered by Dineout\n8:00 pm, 2 people', 'after the heading')
eq(withSwiggyAttribution('One line', 'food'), 'One line\nPowered by Swiggy', 'single line')
const twice = withSwiggyAttribution(withSwiggyAttribution('A\nB', 'instamart'), 'instamart')
eq(twice.split('Powered by Instamart').length - 1, 1, 'idempotent')
const chat = readFileSync('lib/commerce/instamart-chat.ts', 'utf8')
eq((chat.match(/withSwiggyAttribution\(/g) || []).length, 5, 'every Instamart result/cart/outcome reply is attributed')

// 2. OAuth: code exchange keeps the refresh token; refresh rotates and never reuses the old one.
const flow = oauth.newCommerceFlow('swiggy', 'owner-a', 'client-1')
const ex = await oauth.exchangeCommerceCode(flow, 'code-1', (async () => new Response(JSON.stringify({access_token: 'at-1', token_type: 'Bearer', expires_in: 432000, refresh_token: 'rt-1'}), {status: 200})) as any)
eq([ex.refreshToken, ex.clientId], ['rt-1', 'client-1'], 'exchange keeps refresh token and client id')
let sent: any = null
const refreshed = await oauth.refreshCommerceToken('swiggy', ex, (async (_u: string, init: any) => { sent = {url: _u, init}; return new Response(JSON.stringify({access_token: 'at-2', token_type: 'Bearer', expires_in: 432000, refresh_token: 'rt-2'}), {status: 200}) }) as any)
eq(sent.url, 'https://mcp.swiggy.com/auth/token', 'refresh goes to the documented token endpoint')
eq(JSON.parse(sent.init.body), {grant_type: 'refresh_token', refresh_token: 'rt-1', client_id: 'client-1'}, 'documented JSON body')
ok(!('Authorization' in sent.init.headers), 'no Authorization header on refresh')
eq([refreshed.accessToken, refreshed.refreshToken], ['at-2', 'rt-2'], 'rotated tokens returned')
await assert.rejects(oauth.refreshCommerceToken('swiggy', {...ex, refreshToken: undefined}), /commerce_refresh_unavailable/); checks++
await assert.rejects(oauth.refreshCommerceToken('swiggy', ex, (async () => new Response('{}', {status: 400})) as any), /commerce_token_refresh_failed/); checks++
await assert.rejects(oauth.refreshCommerceToken('swiggy', ex, (async () => new Response(JSON.stringify({access_token: 'a', token_type: 'Bearer', expires_in: 9, refresh_token: 'x'.repeat(9000)}), {status: 200})) as any), /commerce_token_response_invalid/); checks++

// 3. Connection store: refresh near expiry, save before use, one refresh at a time, failures never leak.
const rows: any[] = []
const db = {from() {
  const f: Array<(r: any) => boolean> = []
  let patch: any = null
  const q: any = {select() { return q }, eq(k: string, v: any) { f.push(r => r[k] === v); return q },
    update(p: any) { patch = p; return q },
    async upsert(v: any) { const r = rows.find(x => x.telegram_id === v.telegram_id && x.provider === v.provider); if (r) Object.assign(r, v); else rows.push({...v}); return {error: null} },
    async maybeSingle() {
      const found = rows.find(r => f.every(p => p(r))) || null
      if (patch) { if (saveFails) return {data: null, error: {message: 'x'}}; if (found) Object.assign(found, patch) }
      return {data: found, error: null}
    }}
  return q
}}
let saveFails = false, leaseFree = true, refreshCalls = 0
let onRefresh: null | (() => void) = null
const crypto = {encryptVaultValue: (v: string) => 'enc:' + Buffer.from(v).toString('base64'), decryptVaultValue: (v: string) => Buffer.from(v.slice(4), 'base64').toString()}
const exports: any = {}
runInNewContext(ts.transpileModule(readFileSync('lib/commerce/connection-store.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText,
  {exports, console, process, URL, Date, Buffer, require(name: string) {
    if (name === '@/lib/supabase-admin') return {supabaseAdmin: db}
    if (name === '@/lib/security/vault-crypto') return crypto
    if (name === './providers') return {COMMERCE_PROVIDERS: {swiggy: {resource: 'https://mcp.swiggy.com'}}}
    if (name === './oauth') return {refreshCommerceToken: async (_p: string, t: any) => { refreshCalls++; if (t.refreshToken === 'bad') throw new Error('commerce_token_refresh_failed'); if (onRefresh) onRefresh(); return {...t, accessToken: 'at-new', refreshToken: 'rt-new', expiresAt: Date.now() + 5 * 86400_000} }}
    if (name === '@/lib/agent/brain-runtime-guard') return {acquireBrainUserLease: async () => leaseFree ? {ownerToken: 't'} : null, releaseBrainUserLease: async () => true}
    throw new Error('Unexpected dependency ' + name)
  }})
const day = 86400_000
const put = (t: any) => exports.saveCommerceConnection('o', 'swiggy', t)
await put({accessToken: 'at-far', expiresAt: Date.now() + 3 * day, scope: '', refreshToken: 'rt-a'})
eq((await exports.readCommerceConnection('o', 'swiggy')).accessToken, 'at-far', 'far from expiry: no refresh')
eq(refreshCalls, 0, 'no refresh call when not needed')
await put({accessToken: 'at-near', expiresAt: Date.now() + 2 * 3600_000, scope: '', refreshToken: 'rt-a'})
eq((await exports.readCommerceConnection('o', 'swiggy')).accessToken, 'at-new', 'near expiry: refreshed')
const stored = JSON.parse(crypto.decryptVaultValue(rows[0].secret_ciphertext))
eq(stored.refreshToken, 'rt-new', 'rotated refresh token saved')
ok(!JSON.stringify(rows[0].metadata_json).includes('rt-'), 'tokens never in plaintext metadata')
ok(rows[0].metadata_json.authorized_at && rows[0].metadata_json.refreshed_at, 'refresh keeps authorized_at and records refreshed_at')
await put({accessToken: 'at-near', expiresAt: Date.now() + 2 * 3600_000, scope: '', refreshToken: 'rt-a'})
leaseFree = false; refreshCalls = 0
eq((await exports.readCommerceConnection('o', 'swiggy')).accessToken, 'at-near', 'refresh busy elsewhere: current valid token used')
eq(refreshCalls, 0, 'no second concurrent refresh')
await put({accessToken: 'at-dead', expiresAt: Date.now() + 30_000, scope: '', refreshToken: 'rt-a'})
eq(await exports.readCommerceConnection('o', 'swiggy'), null, 'busy and about to expire: reconnect, not a dying token')
leaseFree = true
await put({accessToken: 'at-near', expiresAt: Date.now() + 2 * 3600_000, scope: '', refreshToken: 'bad'})
eq((await exports.readCommerceConnection('o', 'swiggy')).accessToken, 'at-near', 'refresh failure falls back to the still-valid token')
await put({accessToken: 'at-near', expiresAt: Date.now() + 2 * 3600_000, scope: '', refreshToken: 'rt-a'})
saveFails = true
eq(await exports.readCommerceConnection('o', 'swiggy'), null, 'refreshed but not saved: not used')
saveFails = false
// Disconnect while a refresh is in flight: the row is gone, the refreshed token must not bring it back.
await put({accessToken: 'at-near', expiresAt: Date.now() + 2 * 3600_000, scope: '', refreshToken: 'rt-a'})
onRefresh = () => { rows.length = 0 }
eq(await exports.readCommerceConnection('o', 'swiggy'), null, 'disconnected during refresh: nothing returned')
eq(rows.length, 0, 'disconnected during refresh: row not resurrected')
onRefresh = null
// A new sign-in during a refresh wins over the old refresh chain.
await put({accessToken: 'at-near', expiresAt: Date.now() + 2 * 3600_000, scope: '', refreshToken: 'rt-a'})
onRefresh = () => { rows[0].secret_ciphertext = crypto.encryptVaultValue(JSON.stringify({accessToken: 'at-signin', expiresAt: Date.now() + 5 * day, scope: '', refreshToken: 'rt-signin'})) }
eq(await exports.readCommerceConnection('o', 'swiggy'), null, 'new sign-in during refresh: refreshed token dropped')
eq(JSON.parse(crypto.decryptVaultValue(rows[0].secret_ciphertext)).refreshToken, 'rt-signin', 'new sign-in kept')
onRefresh = null
// Already expired: no refresh attempt (Swiggy cannot refresh an expired token).
rows.length = 0; refreshCalls = 0
await put({accessToken: 'at-exp', expiresAt: Date.now() - 1000, scope: '', refreshToken: 'rt-a'})
eq(await exports.readCommerceConnection('o', 'swiggy'), null, 'expired: reconnect needed')
eq(refreshCalls, 0, 'expired: no refresh call')
eq((await exports.readStoredCommerceConnection('o', 'swiggy')).accessToken, 'at-exp', 'disconnect path reads the stored token as-is')
eq(refreshCalls, 0, 'disconnect path never refreshes')
const disc = readFileSync('app/api/commerce/[provider]/disconnect/route.ts', 'utf8')
ok(disc.includes('readStoredCommerceConnection(session.telegramId, provider)') && !/\breadCommerceConnection\(/.test(disc), 'disconnect revokes the stored token without rotating it')
await put({accessToken: 'at-old', expiresAt: Date.now() + 2 * 3600_000, scope: ''})
eq((await exports.readCommerceConnection('o', 'swiggy')).accessToken, 'at-old', 'legacy token without refresh still works until expiry')

// 4. Dineout: read tools only; parsers keep Swiggy's values as given and never call a paid deal free.
const mcp = readFileSync('lib/commerce/mcp.ts', 'utf8')
const dineLine = mcp.split('\n').find(l => /^\s*dineout: \[/.test(l)) || ''
ok(dineLine.includes('get_available_slots') && !/book_table|create_cart|confirm_order|payment/.test(dineLine), 'no Dineout write tools')
ok(readFileSync('lib/commerce/providers.ts', 'utf8').includes("dineout: 'https://mcp.swiggy.com/dineout'"), 'documented Dineout endpoint')
const calls: any[] = []
const reader = {readTool: async (name: string, args: any) => { calls.push([name, args]); return name === 'search_restaurants_dineout'
  ? {restaurants: [{id: 'r1', name: 'Toit', locality: 'Indiranagar', costForTwo: '₹1,500 for two', rating: {value: '4.5', count: 9}, distance: '2.1 km'}, {id: 'r1', name: 'Dup'}, {name: 'No id'}]}
  : {restaurantId: 'r1', slots: [
      {slotId: 1, displayTime: '8:00 PM', reservationTime: 1794580200, availableInventory: 3, isFree: true, deals: []},
      {slotId: 2, displayTime: '8:30 PM', reservationTime: 1794582000, availableInventory: 2, deals: [{isFree: false, displayFee: '₹900', bookingPrice: 900}, {isFree: false, displayFee: '₹500', bookingPrice: 500}]},
      {slotId: 3, displayTime: '9:00 PM', reservationTime: 1794583800, availableInventory: 0, isFree: true},
      {slotId: 4.5, displayTime: 'x', reservationTime: 1, availableInventory: 1},
      {slotId: 5, displayTime: '8:00 PM', reservationTime: 1794580200 + 86400, availableInventory: 4, isFree: true}]} }}
const rs = await readDineoutRestaurants(reader as any, 'Toit', 12.97, 77.64)
eq(rs, [{id: 'r1', name: 'Toit', locality: 'Indiranagar', costForTwo: '₹1,500 for two', rating: '4.5', distance: '2.1 km'}], 'restaurants: as given, deduped, invalid dropped')
const slots = await readDineoutSlots(reader as any, 'r1', '2026-11-13', 12.97, 77.64)
eq(slots.map(s => [s.slotId, s.date, s.free, s.paidFee]), [[1, '2026-11-13', true, null], [2, '2026-11-13', false, '₹500']], 'only the asked day; sold-out/malformed dropped; paid deal not free; cheapest fee')
await assert.rejects(readDineoutSlots(reader as any, 'r1', '13/11/2026', 12.97, 77.64), /commerce_slot_request_invalid/); checks++
await assert.rejects(readDineoutRestaurants(reader as any, 'x', 999, 0), /commerce_location_invalid/); checks++
const wrong = {readTool: async () => ({restaurantId: 'other', slots: []})}
await assert.rejects(readDineoutSlots(wrong as any, 'r1', '2026-11-13', 12.97, 77.64), /commerce_slots_invalid/); checks++

console.log(`PASS verify-swiggy-mcp-ready-nov13: ${checks} checks`)
