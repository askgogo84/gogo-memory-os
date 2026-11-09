// Typed skill registry (8 Nov): definitions vet or are refused; input/output shapes enforced; every declared capability
// must pass the caller's policy (never widened); adapters are off unless named; handlers come only from the static map.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const reg = await import('../lib/agent/skill-registry')
const bi = await import('../lib/agent/skills-builtin')

// 1. Vetting: builtin definitions pass; broken ones name every reason.
for (const b of bi.BUILTIN_SKILLS) assert.deepEqual(reg.vetSkill(b.def), { ok: true }, b.def.id)
const base = bi.BUILTIN_SKILLS[0].def
const bad = reg.vetSkill({ ...base, id: 'Bad Id', sopVersion: '1', limits: { maxSteps: 0, maxMinutes: 999, maxCostPaise: -1 }, requiredCapabilities: [], evidence: [], exactActionApproval: false })
assert.equal(bad.ok, false); if (!bad.ok) { for (const r of ['id must', 'sopVersion', 'capability', 'maxSteps', 'maxMinutes', 'maxCostPaise', 'evidence required', 'irreversible skills need exactActionApproval']) assert.ok(bad.reasons.some(x => x.includes(r)), r) }
const noEvidence = reg.vetSkill({ ...base, evidence: ['none'] }); assert.equal(noEvidence.ok, false)
console.log('✓ vetting: builtins pass; bad definitions refused with every reason')

// 2. Registration: duplicates and unvetted refused; the count is the builtin list.
reg._resetSkillRegistryForTests()
assert.equal(bi.ensureBuiltinSkills(), bi.BUILTIN_SKILLS.length)
assert.equal(reg.listSkills().length, bi.BUILTIN_SKILLS.length)
assert.throws(() => reg.registerSkill(base, async () => ({})), /skill_duplicate/)
assert.throws(() => reg.registerSkill({ ...base, id: 'x.y', evidence: [] }, async () => ({})), /skill_not_vetted/)
assert.throws(() => reg.registerSkill({ ...base, id: 'x.y' }, 'return 1' as any), /skill_handler_invalid/)
assert.deepEqual(reg.skillsForCapability('merchant').map(d => d.id).sort(), ['merchant.ops.digest', 'merchant.order.accept', 'merchant.order.reject'])
console.log('✓ registration: static handlers only; duplicates and strings refused')

// 3. Input validation: unknown keys, wrong types, enum and range; the __bindings never pass through validation.
const ctxAuto = { telegramId: 't1', now: Date.now(), permission: () => 'auto' as const }
const ctxAsk = { telegramId: 't1', now: Date.now(), permission: () => 'ask' as const }
const ctxOff = { telegramId: 't1', now: Date.now(), permission: () => 'off' as const }
assert.equal(reg.canRunSkill('nope.skill', {}, ctxAuto).ok, false)
let d = reg.canRunSkill('merchant.order.accept', { outletId: 'o', orderId: 'T-1', prepMinutes: 15, extra: 1 }, ctxAuto); assert.equal(d.ok, false); if (!d.ok) assert.match(d.detail, /unknown field extra/)
d = reg.canRunSkill('merchant.order.accept', { outletId: 'o', orderId: 'T-1', prepMinutes: 3 }, ctxAuto); assert.equal(d.ok, false); if (!d.ok) assert.match(d.detail, /prepMinutes below 5/)
d = reg.canRunSkill('merchant.order.reject', { outletId: 'o', orderId: 'T-1', reason: 'customer' }, ctxAuto); assert.equal(d.ok, false); if (!d.ok) assert.match(d.detail, /reason not one of/)
d = reg.canRunSkill('merchant.order.accept', { outletId: 'o', orderId: 'T-1', prepMinutes: 15, __adapter: {} }, ctxAuto); assert.equal(d.ok, false); if (!d.ok) assert.match(d.detail, /unknown field __adapter/)
console.log('✓ input: shape, enum, range enforced; bindings cannot be smuggled through input')

// 4. Policy: consequential skills need an approval even at level ask; off blocks; auto alone never executes a consequential merchant action.
d = reg.canRunSkill('merchant.order.accept', { outletId: 'o', orderId: 'T-1', prepMinutes: 15 }, ctxAsk); assert.equal(d.ok, false); if (!d.ok) assert.equal(d.code, 'approval_required')
d = reg.canRunSkill('merchant.order.accept', { outletId: 'o', orderId: 'T-1', prepMinutes: 15 }, ctxAuto); assert.equal(d.ok, false); if (!d.ok) assert.equal(d.code, 'approval_required', 'auto is not enough for a consequential merchant action')
d = reg.canRunSkill('merchant.order.accept', { outletId: 'o', orderId: 'T-1', prepMinutes: 15 }, { ...ctxAsk, approvalStatus: 'approved' }); assert.deepEqual(d, { ok: true })
d = reg.canRunSkill('merchant.ops.digest', {}, ctxOff); assert.equal(d.ok, false); if (!d.ok) assert.equal(d.code, 'permission')
d = reg.canRunSkill('people.brief', { name: 'Nithin' }, { ...ctxAsk, permission: (c) => c === 'calendar' ? 'off' : 'ask' }); assert.equal(d.ok, false); if (!d.ok) assert.match(d.detail, /^calendar: permission_off/)
assert.deepEqual(reg.canRunSkill('people.brief', { name: 'Nithin' }, { ...ctxAsk, permission: () => 'read' }), { ok: true })
console.log('✓ policy: every declared capability must pass; consequential needs an exact approval; nothing widened')

// 5. Adapters: off by default; a skill that needs one is not runnable until named in GOGO_SKILL_ADAPTERS.
reg.registerSkill({ ...base, id: 'web.crawl', title: 'Crawl', purpose: 'test', requiredCapabilities: ['browser'], optionalAdapters: ['firecrawl', 'apify'], exactActionApproval: false, irreversible: false, risk: 'low', evidence: ['none'], input: { url: { type: 'string', required: true } }, output: { text: { type: 'string', required: true } } }, async () => ({ text: 'x' }))
d = reg.canRunSkill('web.crawl', { url: 'https://a' }, { ...ctxAsk, permission: () => 'read' }, {}); assert.equal(d.ok, false); if (!d.ok) assert.equal(d.code, 'adapter_off')
assert.deepEqual(reg.canRunSkill('web.crawl', { url: 'https://a' }, { ...ctxAsk, permission: () => 'read' }, { GOGO_SKILL_ADAPTERS: 'firecrawl' }), { ok: true })
assert.deepEqual([...reg.enabledAdapters({ GOGO_SKILL_ADAPTERS: 'mcp, bogus,apify' })].sort(), ['apify', 'mcp'])
console.log('✓ adapters: off unless named; unknown names ignored')

// 6. Running: the real merchant.order.accept wrapper through the synthetic adapter (bound, not in input); output shape checked; timeouts bounded.
const { buildWorld, SyntheticAdapter } = await import('../lib/enterprise/tipplr/synthetic')
const NOW = Date.parse('2026-11-07T03:40:00Z'); const world = buildWorld('ws', NOW); const adapter = new SyntheticAdapter(world)
const order = (await adapter.listNewOrders('out_cunningham_test'))[0]
const run = await reg.runSkill('merchant.order.accept', { outletId: 'out_cunningham_test', orderId: order.id, prepMinutes: 15 }, { ...ctxAsk, approvalStatus: 'approved' }, {}, { __adapter: adapter })
assert.equal(run.ok, true); if (run.ok) { assert.equal(run.output.state, 'verified_success'); assert.match(String(run.output.text), /^Done: #/) }
const foreign = world.orders.find(o => o.outletId !== 'out_cunningham_test' && o.state === 'delivered')!; foreign.state = 'new'
const cross = await reg.runSkill('merchant.order.accept', { outletId: 'out_cunningham_test', orderId: foreign.id, prepMinutes: 15 }, { ...ctxAsk, approvalStatus: 'approved' }, {}, { __adapter: adapter })
assert.equal(cross.ok, true); if (cross.ok) { assert.equal(cross.output.state, 'blocked'); assert.equal((await adapter.getOrder(foreign.id))!.state, 'new') }
const unbound = await reg.runSkill('merchant.order.accept', { outletId: 'out_cunningham_test', orderId: order.id, prepMinutes: 15 }, { ...ctxAsk, approvalStatus: 'approved' }); assert.equal(unbound.ok, false); if (!unbound.ok) assert.equal(unbound.code, 'failed')
reg.registerSkill({ ...base, id: 'test.slow', requiredCapabilities: ['memory'], exactActionApproval: false, irreversible: false, risk: 'low', evidence: ['none'], input: {}, output: { ok: { type: 'boolean', required: true } }, limits: { maxSteps: 1, maxMinutes: 0.0005, maxCostPaise: 0 } }, () => new Promise(r => setTimeout(() => r({ ok: true }), 200)))
const slow = await reg.runSkill('test.slow', {}, { ...ctxAsk, permission: () => 'read' }); assert.equal(slow.ok, false); if (!slow.ok) assert.equal(slow.code, 'timeout')
reg.registerSkill({ ...base, id: 'test.badout', requiredCapabilities: ['memory'], exactActionApproval: false, irreversible: false, risk: 'low', evidence: ['none'], input: {}, output: { ok: { type: 'boolean', required: true } } }, async () => ({ nope: 1 }))
const badout = await reg.runSkill('test.badout', {}, { ...ctxAsk, permission: () => 'read' }); assert.equal(badout.ok, false); if (!badout.ok) assert.equal(badout.code, 'bad_output')
console.log('✓ run: wrapper reaches the existing action (cross-outlet still blocked); bindings outside input; timeout and output shape enforced')
console.log('Skill registry (8 Nov) checks passed')
