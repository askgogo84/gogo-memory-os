import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const route = read('app/api/cron/agent-learning/route.ts')
const worker = read('lib/agent/learning-worker.ts')
const insights = read('lib/bot/memory-twin/insight-generator.ts')
const vercel = JSON.parse(read('vercel.json'))

assert.match(route, /processLearningPass/)
assert.match(route, /CRON_SECRET/)
assert.match(route, /status:\s*401/)
assert.match(route, /AGENT_LEARNING_CRON_FAILED/)

const cron = vercel.crons.find((x: any) => x.path === '/api/cron/agent-learning')
assert.ok(cron, 'agent-learning cron must be registered')
assert.equal(cron.schedule, '17 * * * *')

assert.match(worker, /user_behavior_events/)
assert.match(worker, /36 \* 3600_000/)
assert.match(worker, /MAX_USERS_PER_PASS\s*=\s*80/)
assert.match(worker, /generateUserInsights/)
assert.match(worker, /failures\.slice\(0,10\)/)

assert.match(insights, /memory_enabled === false/)
assert.match(insights, /proactive_suggestions_enabled === false/)
assert.match(insights, /item\.confidence < 0\.72/)
assert.match(insights, /item\.evidence_count < 5/)
assert.match(insights, /source_refs/)
assert.match(insights, /NON_PROACTIVE_TASKS/)
assert.match(insights, /NOISY_CONTACTS/)

console.log('agent learning verification passed')
