// 17 Nov: the hourly learning job timed out at 60 s 48 times. A slow person no longer holds the pass, and the
// semantic step stops starting owners at its deadline.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const { processLearningPass } = await import('../lib/agent/learning-worker.ts')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const events = ['1', '2', '3'].map(telegram_id => ({ telegram_id }))
const t0 = Date.now()
const r: any = await processLearningPass({ budgetMs: 150, graceMs: 100, concurrency: 1, events, generate: async id => { if (id === '1' || id === 1 as any) await sleep(5_000); return [] } })
const took = Date.now() - t0
assert.ok(took < 1_500, `a 5 s person does not hold the pass (took ${took} ms)`)
assert.ok(JSON.stringify(r).includes('learning_timeout') || r.failed >= 1 || (r.failures || []).length >= 1, 'the slow person is recorded as failed, to retry next hour')
const fast: any = await processLearningPass({ budgetMs: 2_000, concurrency: 2, events, generate: async () => [{ ideaCreated: true }] })
assert.equal(fast.processed, 3, 'normal people are all processed')

const { syncSemanticForEnabledOwners } = await import('../lib/semantic/sync.ts')
const seen: number[] = []
const one = async (a: any) => { seen.push(a.legacyTelegramId); await sleep(60); return {} as any }
const env = { GOGO_SEMANTIC_OWNERS: '11,12,13,14' }
const out = await syncSemanticForEnabledOwners(env, Date.now() + 90, one as any)
assert.ok(seen.length >= 1 && seen.length < 4, `owners after the deadline are not started (started ${seen.length})`)
assert.equal(out.synced + out.deferred, 4, 'every owner is either synced or deferred')
const all = await syncSemanticForEnabledOwners(env, Infinity, (async () => ({})) as any)
assert.deepEqual([all.synced, all.deferred], [4, 0], 'no deadline: unchanged')
const route = readFileSync('app/api/cron/agent-learning/route.ts', 'utf8')
assert.match(route, /syncSemanticForEnabledOwners\(process\.env, started \+ 50_000\)/)
assert.match(route, /Promise\.race\(\[work, cutoff\]\)/)
console.log('PASS verify-agent-learning-deadline-nov17')
process.exit(0)
