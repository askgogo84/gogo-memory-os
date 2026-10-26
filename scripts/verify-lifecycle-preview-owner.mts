// Inert executable regression for the REAL lifecycle-email preview route.
// A signed-in BIGINT owner must not reveal another user's name through Number() rounding.
// No real session, database, provider, email send, HTTP call, or account mutation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const routeText = readFileSync(new URL('../app/api/dashboard/email-preview/route.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(routeText, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

type FakeRow = { telegram_id: string | number; name: string } | null
type Fixture = {
  owner: unknown
  row?: FakeRow
  error?: unknown
  day?: string
}

async function exercise(fixture: Fixture) {
  const calls: Array<{ table: string; columns: string; key: string; value: unknown }> = []
  let rendered = 0
  class ResponseFixture {
    body: string
    status: number
    headers: Record<string, string>
    constructor(body: string, options: { status?: number; headers?: Record<string, string> } = {}) {
      this.body = String(body)
      this.status = options.status ?? 200
      this.headers = options.headers ?? {}
    }
  }
  const db = {
    from(table: string) {
      assert.equal(table, 'users', 'lifecycle preview may only inspect the current user')
      const pending = { table, columns: '', key: '', value: null as unknown }
      const query = {
        select(columns: string) {
          pending.columns = columns
          assert.equal(columns, 'telegram_id,name', 'read returned owner for equality verification')
          return query
        },
        eq(key: string, value: unknown) {
          pending.key = key
          pending.value = value
          assert.equal(key, 'telegram_id')
          assert.equal(typeof value, 'string', 'the DB key must preserve exact decimal text')
          return query
        },
        async maybeSingle() {
          calls.push({ ...pending })
          return { data: fixture.row ?? null, error: fixture.error ?? null }
        },
      }
      return query
    },
  }
  const deps: Record<string, unknown> = {
    'next/server': { NextResponse: ResponseFixture },
    '@/lib/dashboard/session': {
      getSession: async () => fixture.owner === null ? null : { telegramId: fixture.owner },
    },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/email/lifecycle': {
      LIFECYCLE_EMAILS: [{ key: 'first' }, { key: 'second' }, { key: 'third' }],
      renderLifecycleEmail: (params: { firstName: string; email: { key: string } }) => {
        rendered++
        return { html: 'Hi ' + params.firstName + ' / ' + params.email.key }
      },
    },
  }
  const loaded: Record<string, any> = {}
  runInNewContext(compiled, {
    exports: loaded, URL, console, String, Number,
    require: (name: string) => {
      if (!Object.prototype.hasOwnProperty.call(deps, name)) throw Error('Unexpected runtime import: ' + name)
      return deps[name]
    },
  })
  assert.equal(typeof loaded.GET, 'function')
  const url = 'https://app.askgogo.in/api/dashboard/email-preview' +
    (fixture.day === undefined ? '' : '?day=' + encodeURIComponent(fixture.day))
  const response: ResponseFixture = await loaded.GET({ url })
  return { response, calls, rendered }
}

// A previous implementation would round this different tenant's TEXT BIGINT,
// query the adjacent owner row, and display that tenant's first name.
for (const owner of [
  '9007199254740993', '9007199254740992', '-9007199254740993',
  9007199254740992, 0, '0', '-0', '0123', '+123', '123abc',
  '12.3', '1e2', ' 123', '123 ', 'null', '', undefined, {},
]) {
  const r = await exercise({ owner, row: { telegram_id: '9007199254740992', name: 'Foreign Owner' } })
  assert.equal(r.response.status, 403, 'reject malformed/unsafe owner ' + String(owner))
  assert.equal(r.calls.length, 0, 'never read private name with invalid owner')
  assert.equal(r.rendered, 0, 'never render a foreign name for invalid owner')
}
const unauthenticated = await exercise({ owner: null })
assert.equal(unauthenticated.response.status, 401)
assert.equal(unauthenticated.calls.length, 0)

for (const owner of ['123', '-123', '9007199254740991', '-9007199254740991']) {
  const r = await exercise({ owner, row: { telegram_id: owner, name: 'Correct Account' }, day: '2' })
  assert.equal(r.response.status, 200, 'safe owner may see its own name')
  assert.deepEqual(r.calls.map(c => c.value), [owner], 'original string owner preserved to query')
  assert.match(r.response.body, /^Hi Correct \/ third$/)
  assert.equal(r.response.headers['Cache-Control'], 'no-store')
  assert.equal(r.rendered, 1)
}
for (const returnedOwner of ['124', '9007199254740993', 124, -123, null]) {
  const r = await exercise({
    owner: '123',
    row: returnedOwner === null ? null : { telegram_id: returnedOwner, name: 'Wrong Tenant' },
  })
  assert.equal(r.response.status, 404, 'reject wrong returned owner')
  assert.equal(r.rendered, 0, 'do not render another tenant')
}
const dbError = await exercise({
  owner: '123', row: { telegram_id: '123', name: 'Potential Leak' },
  error: { message: 'database unavailable' },
})
assert.equal(dbError.response.status, 503)
assert.equal(dbError.rendered, 0)

console.log('verify-lifecycle-preview-owner: exact typed-owner, 64-bit alias, mismatch, fail-closed and safe-name cases passed')
