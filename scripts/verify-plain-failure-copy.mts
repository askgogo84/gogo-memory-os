import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 16 Oct live screenshot: browser failures read like system logs, and an unfinished Settings sign-in kept showing
// "Sign in to Amazon.in yourself…" as Gogo's current work. Run: npx tsx scripts/verify-plain-failure-copy.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { browserFailureSummary } = await import('../lib/agent/browser-failure-notice')
for (const code of ['browser_objective_unverified', 'browser_read_deadline', 'secure_browser_failed']) {
  const text = browserFailureSummary(code)
  assert.doesNotMatch(text, /No input is requested|resolve the browser failure|needs investigation|AskGogo could not/, code)
  assert.match(text, /Nothing was changed\./, code)
}
assert.match(browserFailureSummary('browser_objective_unverified'), /so I won't guess/)
const read = (p: string) => readFileSync(new URL('../' + p, import.meta.url), 'utf8')
assert.doesNotMatch(read('lib/agent/secure-computer.ts'), /secure reconnect is coming soon/)
const stale = read('lib/agent/stale-runs.ts')
assert.match(stale, /export const ABANDONED_SIGN_IN_HOURS = 2/)
assert.match(stale, /\.not\('metadata_json->>site_session', 'is', null\)/, 'only Settings sign-ins are closed')
assert.match(read('app/api/cron/autonomous-runs/route.ts'), /const abandonedSignInsClosed=await sweepAbandonedSignIns\(\)/)
console.log('verify-plain-failure-copy: ok')
