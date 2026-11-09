// Usage limits from real cost (4 Nov, Gogo: "at least 30% profit"). Every paid plan keeps >= 30% margin even when
// a person uses the whole allowance, using the admin console's measured unit costs. Daily caps match the SQL.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const l = await import('../lib/data/limits')
const plans = l.getPlanLimits() as any
const ACTION_INR = 1.0, BACKGROUND_INR = 60
const kept = (price: number) => (price / 1.18) * 0.98
for (const key of ['lite', 'pro', 'founder_pro']) {
  const p = plans[key], cost = p.monthlyActions * ACTION_INR + BACKGROUND_INR, margin = 1 - cost / kept(p.priceInr)
  assert.ok(margin >= 0.3, `${p.label}: margin ${Math.round(margin * 100)}% at full use`)
  assert.ok(p.costGuardrailInr <= Math.floor(kept(p.priceInr) * 0.7) + 1, `${p.label}: guardrail within the 70% ceiling`)
  assert.ok(p.dailyActions * 4 <= p.monthlyActions + 5, `${p.label}: a day can't empty the month`)
  console.log(`✓ ${p.label} ₹${p.priceInr}: ${p.monthlyActions}/month, ${p.dailyActions}/day, margin at full use ${Math.round(margin * 100)}%`)
}
assert.deepEqual(['free', 'lite', 'pro', 'founder_pro'].map(k => [plans[k].monthlyActions, plans[k].dailyActions]), [[25, 5], [80, 20], [220, 55], [500, 125]])
assert.deepEqual(l.monthlyAllowanceFor('founder_pro'), { monthly: 500, daily: 125, label: 'Gogo Pro' })
assert.equal(l.monthlyAllowanceFor('pro_annual').monthly, 220)
assert.equal(l.monthlyAllowanceFor(null).monthly, 25)
const sql = readFileSync('supabase/plan-limits-margin-20261104.sql', 'utf8')
for (const [codes, n] of [["'free'", 5], ["('lite', 'starter')", 20], ["('pro', 'pro_annual')", 55]] as const)
  assert.ok(sql.includes(`ai_actions_per_day = ${n},`) && sql.includes(codes), `SQL sets ${codes} to ${n}`)
assert.match(sql, /values \('founder_pro', 125,/)
const src = readFileSync('lib/data/limits.ts', 'utf8')
assert.match(src, /const monthlyActionsUsed=\(await monthlyAiUsed\(telegramId\)/, 'chat shows the same monthly count as trends')
assert.match(src, /if\(events!==null\)usedCount=Math\.max\(usedCount,events\)/, 'monthly check counts the same events')
console.log('Usage limits margin checks passed')
