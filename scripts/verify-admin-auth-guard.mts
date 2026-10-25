import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

console.log('admin authorization regression passed')
