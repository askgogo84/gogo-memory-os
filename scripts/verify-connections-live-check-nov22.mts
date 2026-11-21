// 22 Nov (owner-approved mock): Connections gets a live, read-only check. The route is POST + same-origin + session,
// rate-limited per owner, and returns the self-diagnostic checks; the panel lists problems first, working after.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const route = readFileSync(new URL('../app/api/dashboard/connections/check/route.ts', import.meta.url), 'utf8')
assert.match(route, /export async function POST\(/); assert.doesNotMatch(route, /export async function GET\(/, 'never prefetched')
const iOrigin = route.indexOf('requireAgentMutationOrigin(request)'), iSession = route.indexOf('requireAgentSession(request)'), iRun = route.indexOf('runSystemDiagnostic(')
assert.ok(iOrigin > 0 && iOrigin < iSession && iSession < iRun, 'same-origin, then session, then the check')
assert.match(route, /runSystemDiagnostic\(actor, \{ full: true \}\)/)
assert.match(route, /COOLDOWN_MS = 15_000/); assert.doesNotMatch(route, /status: 429/, 'a repeat within 15 s gets the same result, never an error')
assert.match(route, /nothing is marked as working/, 'a failure never claims success')
assert.doesNotMatch(route.replace(/recent\.delete\(/g, ''), /\.(insert|update|upsert|delete)\(|supabaseAdmin/, 'no database writes (the only delete is the in-memory cache)')
const ui: any = await import('../components/dashboard/connections-live-check')
const c = (key: string, status: string, quiet = false) => ({ key, label: key, status, evidence: 'e', at: null, quiet })
let g = ui.groupChecks([c('gmail', 'operational'), c('voice', 'degraded'), c('approvals', 'unverified', true), c('memory', 'unverified')])
assert.equal(g.headline, '1 OK · 2 need a look'); assert.deepEqual(g.look.map((x: any) => x.key), ['voice', 'memory']); assert.deepEqual(g.quiet.map((x: any) => x.key), ['approvals'])
g = ui.groupChecks([c('gmail', 'operational'), c('calendar', 'operational'), c('watchers', 'unverified', true)])
assert.equal(g.headline, 'All 2 OK'); assert.equal(g.look.length, 0)
assert.equal(ui.groupChecks([c('w', 'unverified', true)]).headline, 'Nothing failed')
assert.match(ui.whenLabel('2026-11-21T18:28:00Z'), /^21 Nov, 11:58 pm$/)
const page = readFileSync(new URL('../app/dashboard/(app)/connections/page.tsx', import.meta.url), 'utf8')
assert.ok(page.indexOf('<ConnectionsLiveCheck/>') > 0 && page.indexOf('<ConnectionsLiveCheck/>') < page.indexOf('Saved state'), 'live check above saved state')
const ui2 = readFileSync(new URL('../components/dashboard/connections-live-check.tsx', import.meta.url), 'utf8')
assert.match(ui2, /if \(inFlight\.current\) return/, 'one run at a time')
console.log('✓ Connections live check: POST, same-origin, session, rate-limited, read-only; problems first, quiet items named')
