// #1340 follow-up: a new Razorpay checkout link is created only for the WhatsApp number stored on the billing account
// (full international form). Runs the literal production functions against an inert mock; no network.
'use strict'
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const ts = require('typescript')
const source = readFileSync('lib/bot/handlers/plan-checkout.ts', 'utf8')
const slice = source.slice(source.indexOf('async function hasActiveSubscription('))
const js = ts.transpileModule("const PLAN_LABELS = { essential: 'Gogo Essential', plus: 'Gogo Plus', pro: 'Gogo Pro' };\n" + slice, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function run(rows, actor) {
  const created = []
  const supabaseAdmin = { from() { let id = null; return { select() { return this }, eq(c, v) { if (c === 'telegram_id') id = v; return this }, limit(n) { return Promise.resolve({ data: rows.filter(r => r.telegram_id === id).slice(0, n), error: null }) } } } }
  const createSubscription = async a => { created.push(a); return { shortUrl: 'https://synthetic.invalid/x', planKey: a.planKey } }
  const exports = {}
  const fn = new Function('supabaseAdmin', 'createSubscription', 'exports', 'process', 'console', js + '\nreturn exports.buildPlanCheckoutReply')(supabaseAdmin, createSubscription, exports, { env: {} }, { error() {} })
  return fn(actor, 'plus').then(reply => ({ reply, created }))
}
const free = { telegram_id: 101, whatsapp_id: 'whatsapp:+918884501501', tier: 'free', tier_expires_at: null, subscription_status: 'inactive' }
;(async () => {
  let r = await run([free], { telegramId: 101, whatsappId: 'whatsapp:+918884501501', name: 'A' })
  assert.match(r.reply, /setup link/i); assert.equal(r.created.length, 1)
  r = await run([free], { telegramId: 101, whatsappId: 'whatsapp:+918310441698', name: 'A' })
  assert.match(r.reply, /couldn't verify that this WhatsApp number belongs to your billing account/); assert.equal(r.created.length, 0, 'different number: no link')
  r = await run([free], { telegramId: 101, whatsappId: '8884501501', name: 'A' })
  assert.equal(r.created.length, 0, 'a 10-digit local number never authorizes billing')
  r = await run([{ ...free, whatsapp_id: 'garbage' }], { telegramId: 101, whatsappId: 'whatsapp:+918884501501', name: 'A' })
  assert.equal(r.created.length, 0, 'unparseable stored number fails closed')
  r = await run([], { telegramId: 101, whatsappId: 'whatsapp:+918884501501', name: 'A' })
  assert.equal(r.created.length, 1, 'new account with no stored number keeps main behaviour')
  r = await run([{ ...free, tier: 'pro', subscription_status: 'active' }], { telegramId: 101, whatsappId: null, name: 'A' })
  assert.match(r.reply, /already on an active Gogo plan/); assert.equal(r.created.length, 0)
  console.log('verify-checkout-phone-binding-nov9: 6 cases passed')
})().catch(e => { console.error(e); process.exitCode = 1 })
