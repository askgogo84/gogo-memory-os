import assert from 'node:assert/strict'
import { BUILTIN_SKILLS } from '../lib/agent/skills-builtin'
import { searchSkillIndex, previewSkills, resolveSkillDefinition } from '../lib/agent/skill-discovery'
import { ExecutionBudget } from '../lib/agent/execution-budget'

const defs = BUILTIN_SKILLS.map(x => x.def)
const all = new Set(defs.map(d => d.id + '@' + d.sopVersion))
const empty = new Set<string>()
const hit = searchSkillIndex(defs, 'merchant.order.accept', all)[0]
assert.equal(hit.id, 'merchant.order.accept')
assert.equal('purpose' in hit, false)
assert.equal('input' in hit, false)
assert.deepEqual(searchSkillIndex(defs, 'please the and', all), [])
assert.deepEqual(searchSkillIndex(defs, 'unrelatedaardvark', all), [])
assert.deepEqual(searchSkillIndex(defs, 'accept order', empty), [])
assert.deepEqual(searchSkillIndex(defs, 'accept order', all, 11), [])
assert.deepEqual(searchSkillIndex(defs, 'x'.repeat(2001), all), [])
assert.equal(searchSkillIndex(defs, 'order', all, 1).length, 1)
assert.equal(previewSkills(defs, [hit, hit], all).length, 1)
assert.equal(previewSkills(defs, [hit], all)[0].exactActionApproval, true)
assert.deepEqual(previewSkills(defs, [hit], empty), [])
assert.equal(resolveSkillDefinition(defs, hit, empty), null)
assert.equal(resolveSkillDefinition(defs, { ...hit, version: '0.0.0' }, all), null)
assert.equal(resolveSkillDefinition(defs, hit, all)?.id, hit.id)
assert.equal(resolveSkillDefinition([...defs, defs.find(d => d.id === hit.id)!], hit, all), null)
const hindi = { ...defs[0], title: 'होटल आरक्षण', id: 'hotel.reserve' }
assert.equal(searchSkillIndex([hindi], 'आरक्षण', new Set(['hotel.reserve@' + hindi.sopVersion]))[0].id, hindi.id)

let now = 10
const limits = { maxSteps: 3, maxCostMicrosInr: 100, deadlineMs: 20 }
const budget = new ExecutionBudget(limits, () => now)
limits.maxSteps = 100 // constructor snapshots the trusted limits
assert.deepEqual(budget.reserve('unknown-price', null), { ok: false, reason: 'invalid' })
assert.deepEqual(budget.reserve('negative', -1), { ok: false, reason: 'invalid' })
assert.deepEqual(budget.reserve('nan', NaN), { ok: false, reason: 'invalid' })
assert.deepEqual(budget.reserve('oversized', 101), { ok: false, reason: 'cost' })
assert.deepEqual(budget.reserve('first', 70), { ok: true })
assert.deepEqual(budget.reserve('first', 0), { ok: false, reason: 'duplicate' })
assert.deepEqual(budget.reserve('second', 31), { ok: false, reason: 'cost' })
budget.settle('first', 20)
assert.deepEqual(budget.reserve('second', 80), { ok: true })
budget.settle('second', null)
assert.equal(budget.snapshot().committedCostMicrosInr, 100)
assert.equal(budget.snapshot().unresolved, 1)
assert.throws(() => budget.settle('second', 0))
assert.deepEqual(budget.reserve('second', 0), { ok: false, reason: 'duplicate' })
assert.deepEqual(budget.reserve('third', 0), { ok: true })
assert.deepEqual(budget.reserve('fourth', 0), { ok: false, reason: 'steps' })
const time = new ExecutionBudget({ maxSteps: 1, maxCostMicrosInr: 0, deadlineMs: 20 }, () => now)
now = 20
assert.deepEqual(time.reserve('late', 0), { ok: false, reason: 'deadline' })
now = 10
const over = new ExecutionBudget({ maxSteps: 5, maxCostMicrosInr: 100, deadlineMs: 20 }, () => now)
assert.deepEqual(over.reserve('underestimate', 10), { ok: true })
over.settle('underestimate', 11)
assert.equal(over.snapshot().breached, true)
assert.deepEqual(over.reserve('next', 0), { ok: false, reason: 'breach' })
const invalid = new ExecutionBudget({ maxSteps: 5, maxCostMicrosInr: 100, deadlineMs: 20 }, () => now)
assert.deepEqual(invalid.reserve('bad-settlement', 10), { ok: true })
assert.throws(() => invalid.settle('bad-settlement', Infinity))
assert.deepEqual(invalid.reserve('next', 0), { ok: false, reason: 'breach' })
assert.equal(invalid.snapshot().committedCostMicrosInr, 10)
assert.throws(() => new ExecutionBudget({ maxSteps: 0, maxCostMicrosInr: 0, deadlineMs: 20 }))
console.log('HACHI_FOUNDATIONS_OK: staged discovery, version and visibility rechecks, budget reservations and fail-closed accounting')
