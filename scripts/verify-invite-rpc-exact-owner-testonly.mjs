// TEST ONLY — synthetic RPC fixtures, no provider/network/database/real invitations.
// Execute the actual deployed lib/invites/store.ts redeemInvite export, transpiled in a
// sealed VM with all imported side-effecting modules replaced by inert interceptors.
// This regression is intentionally RED until application-source owner binding is fixed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = 'lib/invites/store.ts'
const source = readFileSync(sourcePath, 'utf8')
assert.match(source, /export async function redeemInvite\(/, 'test must exercise the real source export')
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  esModuleInterop: true, isolatedModules: true,
}}).outputText

let simulated = { data: null, error: null }
const rpcCalls = []
const supabaseAdmin = {
  rpc: async (name, payload) => {
    rpcCalls.push({ name, payload })
    assert.equal(name, 'redeem_invite', 'only the fictional invite RPC is available')
    return structuredClone(simulated)
  },
  from: () => { throw new Error('unexpected database I/O in the inert redeemInvite test') },
}
const codeModule = {
  INVITE_LIMIT: 10, firstName: x => x, inviterJoinedText: () => '',
  makeInviteCode: () => 'fictional-invite',
  normalizeInviteCode: x => x,
}
const module = { exports: {} }
const sandbox = {
  module, exports: module.exports,
  console: { error: () => {}, log: () => {} },
  process: { env: {} },
  require: name => {
    if (name === '@/lib/supabase-admin') return { supabaseAdmin }
    if (name === './core') return codeModule
    if (name === 'node:crypto') return { randomInt: () => 1 }
    if (name === '@/lib/whatsapp') return { sendWhatsApp: () => { throw new Error('provider call forbidden') } }
    if (name === '@/lib/services/notification-delivery') return { deliverNotification: () => { throw new Error('notification forbidden') } }
    throw new Error('unexpected dependency: ' + name)
  },
}
vm.runInNewContext(compiled, sandbox, { filename: sourcePath, timeout: 4000 })
const { redeemInvite } = module.exports
assert.equal(typeof redeemInvite, 'function', 'production export must load in the sealed VM')

const use = async (id, opts = {}) => {
  const code = 'fake-rpc-code'
  simulated = {
    data: { ok: opts.ok ?? true, reason: opts.reason ?? 'joined',
      redemption_id: 'fictional-redemption', inviter_telegram_id: id, remaining: 2 },
    error: opts.error ?? null,
  }
  return redeemInvite(code, '+919876543210', 'Synthetic')
}
let passed = 0, failed = 0, controls = 0, mandatory = 0, red = 0
async function check(name, must, run) {
  try { await run(); passed++; if (!must) controls++; else mandatory++; console.log('PASS ' + (must?'MANDATORY ':'CONTROL ') + name) }
  catch (e) { failed++; if (must) { red++; mandatory++ } console.error('FAIL ' + (must?'MANDATORY ':'CONTROL ') + name + ': ' + (e?.message || e)) }
}
const exactOrFailClosed = (res, expected) =>
  assert.ok(res?.ok !== true || String(res.inviterTelegramId) === expected,
    'a successful redeem must preserve the exact RPC owner ID; otherwise deny redemption')
const denied = res => assert.equal(res?.ok, false, 'malformed/unsafe owner must fail closed before calling inviter-bound operations')

await check('safe positive integer owner', false, async () => { const r = await use(123456789); assert.equal(r.ok, true); assert.equal(r.inviterTelegramId, 123456789) })
await check('safe negative mobile owner', false, async () => { const r = await use(-123456789); assert.equal(r.ok, true); assert.equal(r.inviterTelegramId, -123456789) })
await check('safe positive canonical decimal string', false, async () => { const r = await use('42'); assert.equal(r.ok, true); assert.equal(String(r.inviterTelegramId), '42') })
await check('safe negative canonical decimal string', false, async () => { const r = await use('-42'); assert.equal(r.ok, true); assert.equal(String(r.inviterTelegramId), '-42') })
await check('RPC rejection is preserved', false, async () => { const r=await use(42,{ok:false,reason:'used_up'}); assert.equal(r.ok,false); assert.equal(r.reason,'used_up') })
await check('RPC errors cannot pass redemption', false, async () => { const r=await use(42,{error:{code:'P0001',message:'fictional failure'}}); assert.equal(r.ok,false); assert.equal(r.reason,'error') })
await check('null inviter is represented as null', false, async () => { const r=await use(null,{ok:false,reason:'invalid'}); assert.equal(r.inviterTelegramId,null) })
await check('unchanged caller phone is transmitted only to inert RPC', false, async () => {
  await use(33); const last=rpcCalls.at(-1); assert.equal(last.payload.p_phone,'+919876543210'); assert.equal(last.payload.p_code,'fake-rpc-code')
})

// Mandatory regression contracts: either preserve exact signed 64-bit identity or
// reject any ID the legacy numeric representation cannot carry safely.
await check('adjacent 64-bit owners never resolve to one inviter', true, async () => {
  const a=await use('9007199254740992'), b=await use('9007199254740993')
  assert.ok(a.ok !== true || b.ok !== true || String(a.inviterTelegramId)!==String(b.inviterTelegramId),
    'two different stored owners collapsed into the same inviter')
})
await check('large positive int64 inviter is exact or denied', true, async () => exactOrFailClosed(await use('9007199254740993'),'9007199254740993'))
await check('large negative int64 inviter is exact or denied', true, async () => exactOrFailClosed(await use('-9007199254740993'),'-9007199254740993'))
await check('already-rounded unsafe numeric inviter is denied', true, async () => denied(await use(9007199254740992)))
await check('out-of-signed-int64 inviter string is denied', true, async () => denied(await use('9223372036854775808')))
await check('exponent-encoded inviter is denied', true, async () => denied(await use('4.2e1')))
await check('fractional inviter is denied', true, async () => denied(await use('42.5')))
await check('leading zeroes are denied (no normalization guess)', true, async () => denied(await use('00042')))
await check('whitespace padded inviter is denied', true, async () => denied(await use(' 42 ')))
await check('zero inviter is denied', true, async () => denied(await use('0')))
await check('negative zero inviter is denied', true, async () => denied(await use('-0')))
await check('successful RPC without owner cannot authorize follow-up', true, async () => denied(await use(null,{ok:true})))

console.log('INVITE_RPC_EXACT_OWNER result', JSON.stringify({controls,mandatory,red,passed,failed,source:sourcePath,synthetic:true}))
if (failed) process.exitCode = 1
