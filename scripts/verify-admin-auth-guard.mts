import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dashboardAccountIsActive, exactDashboardOwnerId } from '../lib/dashboard/session-access.ts'

const auth=readFileSync('lib/admin/auth.ts','utf8')
const layout=readFileSync('app/admin/layout.tsx','utf8')
const users=readFileSync('app/api/admin/users/route.ts','utf8')
const analytics=readFileSync('lib/bot/handlers/admin-analytics.ts','utf8')

assert.match(auth,/getSession/)
assert.match(auth,/from\('users'\)/)
assert.match(auth,/isAdminPhone/)
assert.match(auth,/status: 401/)
assert.match(auth,/status: 403/)
assert.match(auth,/user_lookup_failed/)
assert.match(layout,/requireAdminSession/)
assert.match(layout,/redirect\(/)

assert.match(users,/requireAdminSession/)
assert.match(users,/verifySameOrigin/)
assert.match(users,/export async function GET/)
assert.match(users,/export async function POST/)
assert.match(users,/if \(!admin\.ok\)/)
assert.match(analytics,/ADMIN_WHATSAPP_NUMBERS/)
assert.match(analytics,/if \(!allowed\.length\) return false/)

const postIndex=users.indexOf('export async function POST')
const originIndex=users.indexOf('verifySameOrigin(req)',postIndex)
const adminIndex=users.indexOf('requireAdminSession()',postIndex)
const bodyIndex=users.indexOf('await req.json()',postIndex)
assert.ok(originIndex>postIndex&&originIndex<bodyIndex,'POST must validate same-origin before reading/mutating input')
assert.ok(adminIndex>postIndex&&adminIndex<bodyIndex,'POST must authorize admin before reading/mutating input')

// P1 regression: blocking an existing user must invalidate *already minted* 30-day cookies,
// not just deny a new cookie. The same exact persisted user row must guard both paths.
const dashboardSession = readFileSync('lib/dashboard/session.ts', 'utf8')
assert.match(dashboardSession, /import \{ dashboardAccountIsActive \}/)
assert.match(dashboardSession, /if \(!\(await sessionOwnerAllowed\(telegramId\)\)\) return null/)
assert.match(dashboardSession, /if \(!\(await sessionOwnerAllowed\(data\.telegram_id\)\)\) return null/)
assert.equal((dashboardSession.match(/await sessionOwnerAllowed\(/g) || []).length, 2, 'issuance and every session read must recheck current owner')
assert.match(dashboardSession, /\.eq\('telegram_id', id\)/, 'must resolve the exact session owner, never a suffix or client-supplied ID')

let status: string | null = 'active'
let missing = false
let dbError: unknown = null
let throwDb = false
const lookedUp: number[] = []
const readOwner = async (id: number) => {
  lookedUp.push(id)
  if (throwDb) throw new Error('synthetic DB outage')
  return { data: missing ? null : { access_status: status }, error: dbError }
}
assert.equal(exactDashboardOwnerId('-987654321'), -987654321, 'negative WhatsApp fallback ids stay valid when exact')
assert.equal(await dashboardAccountIsActive('101', readOwner), true, 'existing active owner is allowed')
assert.equal(lookedUp.at(-1), 101)
status = null
assert.equal(await dashboardAccountIsActive('101', readOwner), true, 'historical null access_status remains allowed')
status = 'blocked'
assert.equal(await dashboardAccountIsActive('101', readOwner), false, 'blocked-after-session-issuance denies access')
status = 'active'
missing = true
assert.equal(await dashboardAccountIsActive('101', readOwner), false, 'deleted owner row denies access')
missing = false
dbError = { code: 'PGRST100' }
assert.equal(await dashboardAccountIsActive('101', readOwner), false, 'owner DB lookup errors fail closed')
dbError = null
throwDb = true
assert.equal(await dashboardAccountIsActive('101', readOwner), false, 'owner DB exceptions fail closed')
throwDb = false
const beforeInvalid = lookedUp.length
for (const value of ['9007199254740993', '0', '00101', '101 ', '+101', 'abc', '', null, undefined]) {
  assert.equal(await dashboardAccountIsActive(value, readOwner), false, 'invalid/unsafe owner ids never authenticate')
}
assert.equal(lookedUp.length, beforeInvalid, 'invalid identities must not query another owner')
assert.equal(await dashboardAccountIsActive('-987654321', readOwner), true, 'exact negative legacy owner remains supported')

console.log('admin authorization regression passed')
