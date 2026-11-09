// Red #1171 resolution (owner default: retire). The WhatsApp "LINK <code>" device-code pairing had no WhatsApp
// handler and its parser read "connect calendar" as a device code. Proves:
//  1. POST /api/mobile/link/start answers 410 Gone with a short JSON error and touches no database.
//  2. No WhatsApp text (including "connect calendar") can be parsed into a LINK device code: the parser and the
//     approval/creation helpers are gone and nothing in app/ or lib/ references them.
//  3. The WhatsApp OTP sign-in path (otp start/verify, status, exchange) still works.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { createHash } from 'node:crypto'
import * as nodeCrypto from 'node:crypto'
import ts from 'typescript'

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')
const NextResponse = { json: (body: any, init: any = {}) => new Response(JSON.stringify(body), { status: init.status || 200, headers: { 'content-type': 'application/json' } }) }

function load(path: string, deps: Record<string, any>) {
  const exports: any = {}
  const module = { exports }
  const required: string[] = []
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  runInNewContext(code, {
    exports, module, console, Response, Request, URL, Date, Promise, JSON, String, Number, Boolean, Error, Buffer,
    require: (name: string) => { required.push(name); if (!(name in deps)) throw new Error(`unexpected require ${name} from ${path}`); return deps[name] },
  })
  return { mod: module.exports, required }
}

const forbiddenDb = new Proxy({}, { get: (_t, prop) => { throw new Error(`database touched: supabaseAdmin.${String(prop)}`) } })

// 1. start route: 410, no DB
{
  const { mod, required } = load('app/api/mobile/link/start/route.ts', { 'next/server': { NextResponse }, '@/lib/supabase-admin': { supabaseAdmin: forbiddenDb }, '@/lib/mobile-auth/link': new Proxy({}, { get: (_t, p) => { throw new Error(`link lib used: ${String(p)}`) } }) })
  for (const body of [JSON.stringify({ platform: 'ios', deviceId: 'dev-1' }), JSON.stringify({ platform: 'android' }), 'not json', '']) {
    const res = await mod.POST(new Request('https://app.askgogo.in/api/mobile/link/start', { method: 'POST', body, headers: { 'content-type': 'application/json' } }))
    assert.equal(res.status, 410, 'retired LINK start must answer 410 Gone')
    const json = await res.json()
    assert.equal(json.error, 'mobile_link_retired')
    assert.equal(json.code, undefined, 'no device code may be issued')
    assert.equal(json.whatsappMessage, undefined, 'no LINK message may be issued')
    assert.equal(json.pollToken, undefined)
  }
  assert.deepEqual(required.filter(r => r !== 'next/server'), [], 'retired route must not load the database or link library')
}

// 2. no LINK device-code parsing anywhere
{
  const { mod } = load('lib/mobile-auth/link.ts', { 'crypto': nodeCrypto, '@/lib/supabase-admin': { supabaseAdmin: forbiddenDb } })
  for (const name of ['parseMobileLinkCommand', 'approveMobileLink', 'createMobileLinkRequest', 'normalizeMobileLinkCode']) {
    assert.equal(name in mod, false, `${name} must be retired`)
  }
  assert.equal(JSON.stringify(Object.keys(mod).sort()), JSON.stringify(['exchangeMobileLink', 'getMobileLinkStatus']))
  // Any surviving export must not turn chat text into an approval: call each with the phrases and require no DB use
  // beyond a poll-token lookup (status) or the exchange RPC, and never a code_hash approval.
  for (const text of ['connect calendar', 'link calendar', 'pair calendar', 'CONNECT CALENDAR', 'link gogo-calendar', 'LINK CA1E-NDAR', 'connect gmail now']) {
    const writes: any[] = []
    const q: any = { select: () => q, eq: (k: string, v: any) => { writes.push(['eq', k, v]); return q }, maybeSingle: async () => ({ data: null, error: null }), update: (row: any) => { writes.push(['update', row]); return q } }
    const db = { from: (t: string) => { writes.push(['from', t]); return q }, rpc: async (fn: string, args: any) => { writes.push(['rpc', fn, args]); return { data: null, error: null } } }
    const { mod: m } = load('lib/mobile-auth/link.ts', { 'crypto': nodeCrypto, '@/lib/supabase-admin': { supabaseAdmin: db } })
    assert.equal(JSON.stringify(await m.getMobileLinkStatus(text)), JSON.stringify({ status: 'not_found' }))
    assert.equal(await m.exchangeMobileLink({ pollToken: text, platform: 'ios' }), null)
    assert.equal(writes.some(w => w[0] === 'update' || (w[0] === 'eq' && w[1] === 'code_hash')), false, `"${text}" must never approve a link code`)
  }
  const roots = ['app', 'lib']
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry)
      if (statSync(p).isDirectory()) { walk(p); continue }
      if (!/\.(ts|tsx|mts|js|mjs)$/.test(p)) continue
      const src = readFileSync(p, 'utf8')
      if (/\b(parseMobileLinkCommand|approveMobileLink|createMobileLinkRequest|normalizeMobileLinkCode)\s*\(/.test(src)) hits.push(p)
      if (/\(\?:link\|connect\|pair\)\\s\+/.test(src)) hits.push(`${p} (LINK device-code regex)`)
    }
  }
  roots.forEach(walk)
  assert.deepEqual(hits, [], 'no code may parse or approve LINK device codes')
}

// 3. OTP sign-in still works end to end (start -> WhatsApp code -> verify RPC; status + exchange routes intact)
{
  const inserts: any[] = []
  const sent: any[] = []
  const rpcs: any[] = []
  const mk = (table: string) => {
    const q: any = {
      select: () => q, eq: () => q, gte: async () => ({ count: 0, error: null }), in: () => q,
      limit: async () => ({ data: table === 'users' ? [{ id: 'user-1', whatsapp_id: '+919900000001' }] : [], error: null }),
      insert: (row: any) => { inserts.push([table, row]); return q }, single: async () => ({ data: { id: 'link-1' }, error: null }),
      update: () => q,
    }
    return q
  }
  const db = { from: mk, rpc: async (fn: string, args: any) => { rpcs.push([fn, args]); return { data: true, error: null } } }
  const { mod: otp } = load('lib/mobile-auth/otp.ts', { 'crypto': nodeCrypto, '@/lib/supabase-admin': { supabaseAdmin: db }, '@/lib/channels/whatsapp': { sendWhatsAppMessage: async (to: string, body: string) => { sent.push([to, body]) } } })
  const started = await otp.startWhatsappOtpLink({ whatsappNumber: '+91 99000 00001', platform: 'android' })
  assert.equal(started.linkId, 'link-1')
  assert.ok(started.pollToken.length >= 32)
  assert.equal(inserts.length, 1)
  assert.equal(inserts[0][1].user_id, 'user-1')
  assert.equal(inserts[0][1].poll_token_hash, sha256(started.pollToken))
  assert.equal(sent.length, 1)
  assert.equal(sent[0][0], '+919900000001')
  const code = String(sent[0][1]).match(/\*(\d{6})\*/)?.[1]
  assert.ok(code, 'OTP message carries a 6-digit code')
  assert.equal(inserts[0][1].code_hash, sha256(code!))
  assert.equal(await otp.verifyWhatsappOtpLink({ pollToken: started.pollToken, code: code! }), true)
  assert.equal(JSON.stringify(rpcs[0]), JSON.stringify(['mobile_verify_link', { p_poll_token_hash: sha256(started.pollToken), p_code_hash: sha256(code!) }]))
  assert.equal(await otp.verifyWhatsappOtpLink({ pollToken: started.pollToken, code: 'connect calendar' }), false)

  const okRoute = (path: string, deps: any) => load(path, { 'next/server': { NextResponse }, ...deps }).mod
  const startRoute = okRoute('app/api/mobile/link/otp/start/route.ts', { '@/lib/mobile-auth/otp': { startWhatsappOtpLink: async () => ({ linkId: 'l', pollToken: 'p'.repeat(43), expiresAt: 'x', message: 'm' }) } })
  assert.equal((await startRoute.POST(new Request('https://x/a', { method: 'POST', body: JSON.stringify({ platform: 'ios', whatsappNumber: '+919900000001' }) }))).status, 202)
  const verifyRoute = okRoute('app/api/mobile/link/otp/verify/route.ts', { '@/lib/mobile-auth/otp': { verifyWhatsappOtpLink: async () => true } })
  assert.equal((await verifyRoute.POST(new Request('https://x/a', { method: 'POST', body: JSON.stringify({ pollToken: 'p'.repeat(43), code: '123456' }) }))).status, 200)
  const statusRoute = okRoute('app/api/mobile/link/status/route.ts', { '@/lib/mobile-auth/link': { getMobileLinkStatus: async () => ({ status: 'approved', approvedAt: 'a', expiresAt: 'b' }) } })
  assert.equal((await statusRoute.POST(new Request('https://x/a', { method: 'POST', body: JSON.stringify({ pollToken: 'p'.repeat(43) }) }))).status, 200)
  const exchangeRoute = okRoute('app/api/mobile/session/exchange/route.ts', { '@/lib/mobile-auth/link': { exchangeMobileLink: async () => ({ accessToken: 't', sessionId: 's', expiresAt: 'e' }) } })
  assert.equal((await exchangeRoute.POST(new Request('https://x/a', { method: 'POST', body: JSON.stringify({ platform: 'ios', pollToken: 'p'.repeat(43) }) }))).status, 200)
}

console.log('verify-mobile-link-retired-nov10: PASS (410 with no DB, no LINK device-code parsing, OTP sign-in intact)')
