// 15 Nov audit: 14 routes carried their own copy of the CRON_SECRET check with a plain ===. They now use the shared
// constant-time helpers, with exactly the acceptance each copy had (7 accepted ?secret= too; 7 were bearer-only).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { isCronAuthorized, isCronBearerAuthorized } from '../lib/security/cron-auth.ts'
let checks = 0
const eq = (a: unknown, b: unknown, m: string) => { assert.deepEqual(a, b, m); checks++ }
const env = { CRON_SECRET: 's3cret-value' }
const req = (headers: Record<string, string> = {}, qs = '') => new Request('https://x.test/api/cron/y' + qs, { headers })
eq(isCronBearerAuthorized(req({ authorization: 'Bearer s3cret-value' }), env), true, 'bearer accepted')
eq(isCronBearerAuthorized(req({ authorization: 's3cret-value' }), env), true, 'raw header value accepted, as the old copies did')
eq(isCronBearerAuthorized(req({}, '?secret=s3cret-value'), env), false, 'bearer-only routes still refuse ?secret=')
eq(isCronBearerAuthorized(req({ authorization: 'Bearer wrong' }), env), false, 'wrong secret refused')
eq(isCronBearerAuthorized(req({ authorization: 'Bearer s3cret-valu' }), env), false, 'prefix of the secret refused')
eq(isCronBearerAuthorized(req({ authorization: 'Bearer ' }), {}), false, 'unset secret fails closed')
eq(isCronBearerAuthorized(req({}), { CRON_SECRET: '' }), false, 'empty secret fails closed')
eq(isCronAuthorized(req({}, '?secret=s3cret-value'), env), true, 'query-accepting routes still accept ?secret=')
eq(isCronAuthorized(req({ authorization: 'Bearer s3cret-value' }), env), true, 'and the bearer')
eq(isCronAuthorized(req({}, '?secret=nope'), env), false, 'wrong query refused')
const BEARER_ONLY = ['app/api/agent/approved-browser/route.ts', 'app/api/cron/agent-goals/route.ts', 'app/api/cron/agent-learning/route.ts', 'app/api/cron/booking-rehearsal/route.ts', 'app/api/cron/ops-alerts/route.ts', 'app/api/cron/reengage/route.ts', 'app/api/cron/wa-meta-inbox/route.ts']
const WITH_QUERY = ['app/api/cron/agent-watchers/route.ts', 'app/api/cron/autonomous-runs/route.ts', 'app/api/cron/autonomy-pulse/route.ts', 'app/api/cron/booking-events/route.ts', 'app/api/cron/life-events/route.ts', 'app/api/cron/open-loops/route.ts', 'app/api/cron/tipplr-pilot/route.ts']
for (const f of BEARER_ONLY) eq(/const authorized = \(request: Request\) => isCronBearerAuthorized\(request\)/.test(readFileSync(f, 'utf8')), true, `${f}: bearer-only, shared`)
for (const f of WITH_QUERY) eq(/const authorized = \(request: Request\) => isCronAuthorized\(request\)/.test(readFileSync(f, 'utf8')), true, `${f}: bearer or ?secret=, shared`)
// No route under app/ keeps a hand-rolled comparison against CRON_SECRET.
const local = execSync("grep -rlE \"=== ?expected|===expected\" app --include=route.ts || true", { encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter(f => /CRON_SECRET/.test(readFileSync(f, 'utf8')))
eq(local, [], 'no route compares CRON_SECRET with a plain ===')
console.log(`PASS verify-cron-auth-shared-nov15: ${checks} checks`)
