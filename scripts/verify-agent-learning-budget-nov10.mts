// The agent-learning cron timed out at 60 s in production (12 times since July). The pass is now bounded in time,
// works a few users at once, and rotates its starting point. Offline: fake users and a fake generator.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { processLearningPass } = await import('../lib/agent/learning-worker.ts')

let checks = 0
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const ok = (c: unknown, m: string) => { assert.ok(c, m); checks++ }
const events = Array.from({ length: 100 }, (_, i) => ({ telegram_id: String(1000 + i) }))
events.push({ telegram_id: '9007199254740993' }, { telegram_id: 'abc' as any }, { telegram_id: '1000' })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Slow users: 200 ms each, budget 1 s, 4 at a time -> about 20 users, and the pass ends near the budget.
const seen: string[] = []
const slow = await processLearningPass({ events, budgetMs: 1000, concurrency: 4, now: 0, generate: async id => { seen.push(id); await sleep(200); return [{ ideaCreated: true }] } })
ok(slow.ms < 1000 + 300, `the pass ends within its budget plus one user (${slow.ms} ms)`)
ok(slow.processed >= 16 && slow.processed <= 24, `about four users at a time were worked (${slow.processed})`)
eq(slow.usersConsidered, 80, 'at most 80 users are considered per pass')
eq(slow.deferred, 80 - slow.processed, 'the rest are reported as deferred, not as failures')
eq([slow.insights, slow.ideas], [slow.processed, slow.processed], 'results are counted')
ok((await processLearningPass({ events: [{ telegram_id: '9007199254740993' }], generate: async id => { assert.equal(id, '9007199254740993'); return [] } })).processed === 1, 'a 64-bit owner id passes through as an exact string')
ok(!seen.includes('abc') && new Set(seen).size === seen.length, 'malformed ids are dropped and nobody is worked twice')

// The starting point rotates every ten minutes, so the tail of the list is reached.
const first = async (now: number) => { const order: string[] = []; await processLearningPass({ events, budgetMs: 1000, concurrency: 1, now, generate: async id => { order.push(id); return [] } }); return order[0] }
ok((await first(0)) !== (await first(600_000)), 'a later run starts somewhere else in the list')

// Failures are counted and never stop the pass.
const mixed = await processLearningPass({ events: events.slice(0, 10), budgetMs: 5000, generate: async id => { if (id.endsWith('3')) throw new Error('boom'); return [] } })
eq([mixed.processed, mixed.failures.length, mixed.deferred], [9, 1, 0], 'one failing user is recorded and the others are worked')

// Fast users: everyone is worked well inside the budget.
const fast = await processLearningPass({ events, budgetMs: 5000, generate: async () => [] })
eq([fast.processed, fast.deferred], [80, 0], 'with quick users every considered user is worked')

const route = readFileSync(new URL('../app/api/cron/agent-learning/route.ts', import.meta.url), 'utf8')
ok(/processLearningPass\(\{ budgetMs: 40_000 \}\)/.test(route) && /Date\.now\(\) - started < 60_000 - 12_000/.test(route) && /export const maxDuration = 60/.test(route), 'the cron gives learning 40 s and runs semantic sync only with 12 s to spare')
console.log(`AGENT_LEARNING_BUDGET_OK ${checks} checks`)
