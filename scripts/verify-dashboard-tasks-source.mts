import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import * as ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity'

const data = readFileSync(new URL('../lib/dashboard/tasks.ts', import.meta.url), 'utf8')
const page = readFileSync(new URL('../app/dashboard/(app)/tasks/page.tsx', import.meta.url), 'utf8')
const manager = readFileSync(new URL('../components/dashboard/task-manager.tsx', import.meta.url), 'utf8')
const route = readFileSync(new URL('../app/api/dashboard/tasks/route.ts', import.meta.url), 'utf8')

// Release gate: Tasks must remain a first-class in-dashboard to-do surface.
let failed = 0
function check(ok:boolean, label:string){
  if(ok) console.log(`✓ ${label}`)
  else { failed++; console.error(`✗ ${label}`) }
}

check(data.includes(".from('todos')"), 'Tasks dashboard reads the real todos table')
check(!data.includes(".from('reminders')"), 'Tasks dashboard does not duplicate reminders')
check(data.includes(".select('whatsapp_id')"), 'Tasks resolve the signed-in user to the shared WhatsApp identity')
check(page.includes('TaskManager') && page.includes('Open') && page.includes('Completed'), 'Tasks UI exposes Open and Completed boards')
check(!page.includes('title="Today"') && !page.includes('title="Upcoming"'), 'Tasks UI no longer presents reminder-style Today/Upcoming buckets')
check(manager.includes("'/api/dashboard/tasks'") && manager.includes("method:'POST'"), 'Tasks can be added directly inside the dashboard')
check(manager.includes("method:'PATCH'") && manager.includes('Mark task complete'), 'Tasks can be completed or restored directly inside the dashboard')
check(route.includes('verifySameOrigin(request)') && route.includes('getSession()'), 'Dashboard task mutations require same-origin authenticated session')
check(route.includes(".eq('whatsapp_id', whatsappId)"), 'Task updates stay scoped to the signed-in user')
check(!page.includes('Gogo, add task:'), 'Creating a task no longer requires leaving AskGogo for WhatsApp')

if(failed) process.exit(1)
console.log('✅ Dashboard Tasks source, mutation and presentation checks passed')


// P1 isolation gate: execute REAL transpiled task read and mutation handlers with an
// inert two-owner service-role database. No network, provider, customer records or writes.
type TaskRow = { id: string; whatsapp_id: string; text: string; done: boolean; created_at: string; done_at: string | null }
const ownerA = '9007199254740992'
const ownerB = '9007199254740993'
assert.equal(Number(ownerA), Number(ownerB), 'the regression requires JS Number collision')
assert.equal(exactSessionOwnerId(ownerA), ownerA)
assert.equal(exactSessionOwnerId(ownerB), ownerB)
const users: Record<string, { whatsapp_id: string }> = {
  [ownerA]: { whatsapp_id: 'whatsapp:+14155550001' },
  [ownerB]: { whatsapp_id: 'whatsapp:+14155550002' },
  '42': { whatsapp_id: 'whatsapp:+14155550042' },
}
const todos: TaskRow[] = [
  { id: 'owner-a-task', whatsapp_id: users[ownerA].whatsapp_id, text: 'A confidential task', done: false, created_at: '2026-10-01T00:00:00Z', done_at: null },
  { id: 'owner-b-task', whatsapp_id: users[ownerB].whatsapp_id, text: 'B confidential task', done: false, created_at: '2026-10-02T00:00:00Z', done_at: null },
]
const queries: Array<{ table: string; operation: string; where: Record<string, unknown> }> = []
const supabaseAdminInert = {
  from(table: string) {
    const where: Record<string, unknown> = {}
    let mode = 'read'
    let insertRow: Record<string, any> = {}
    let updateRow: Record<string, any> = {}
    const q: any = {
      select: (_fields: string) => q,
      eq: (key: string, value: unknown) => { where[key] = value; return q },
      order: () => q,
      limit: async () => {
        assert.equal(table, 'todos')
        queries.push({ table, operation: 'read', where: { ...where } })
        return {
          data: todos.filter(t => t.whatsapp_id === where.whatsapp_id)
            .map(({ id, text, done, created_at, done_at }) => ({ id, text, done, created_at, done_at })),
          error: null,
        }
      },
      maybeSingle: async () => {
        queries.push({ table, operation: mode, where: { ...where } })
        if (table === 'users') {
          return { data: users[String(where.telegram_id)] ?? null, error: null }
        }
        assert.equal(table, 'todos')
        assert.equal(mode, 'update')
        const row = todos.find(t => t.id === where.id && t.whatsapp_id === where.whatsapp_id)
        if (row) Object.assign(row, updateRow)
        return { data: row ? { id: row.id } : null, error: null }
      },
      insert: (row: Record<string, any>) => { mode = 'insert'; insertRow = row; return q },
      update: (row: Record<string, any>) => { mode = 'update'; updateRow = row; return q },
      single: async () => {
        assert.equal(table, 'todos')
        assert.equal(mode, 'insert')
        queries.push({ table, operation: mode, where: { ...where } })
        const id = 'synthetic-new-task-' + (todos.length + 1)
        todos.push({ id, whatsapp_id: String(insertRow.whatsapp_id), text: String(insertRow.text), done: false,
          created_at: String(insertRow.created_at), done_at: null })
        return { data: { id }, error: null }
      },
    }
    return q
  },
}

let sessionOwner: string | null = null
const modules: Record<string, any> = {
  '@/lib/supabase-admin': { supabaseAdmin: supabaseAdminInert },
  './owner-identity': { exactSessionOwnerId },
  '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
  'next/server': { NextResponse: { json: (body: any, options?: { status?: number }) => ({
    status: options?.status ?? 200, body,
  }) } },
  '@/lib/dashboard/session': { getSession: async () => sessionOwner ? { telegramId: sessionOwner } : null },
  '@/lib/dashboard/guard': { verifySameOrigin: () => null },
}
function transpileRealSource(sourcePath: string): Record<string, any> {
  const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8')
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
    reportDiagnostics: true,
  })
  assert.equal(result.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error).length || 0, 0,
    'transpilation of actual source must succeed')
  const exports: Record<string, any> = {}
  const requireInert = (specifier: string) => {
    assert.ok(Object.prototype.hasOwnProperty.call(modules, specifier), 'unexpected dependency: ' + specifier)
    return modules[specifier]
  }
  new Function('exports', 'require', result.outputText)(exports, requireInert)
  return exports
}
const taskReader = transpileRealSource('../lib/dashboard/tasks.ts')
const taskRoute = transpileRealSource('../app/api/dashboard/tasks/route.ts')

function taskRequest(method: string, payload: unknown): Request {
  return new Request('https://app.askgogo.in/api/dashboard/tasks', {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  })
}

const readA = await taskReader.getDashboardTasks(ownerA)
const readB = await taskReader.getDashboardTasks(ownerB)
assert.deepEqual(readA.open.map((t: any) => t.id), ['owner-a-task'])
assert.deepEqual(readB.open.map((t: any) => t.id), ['owner-b-task'])
assert.deepEqual(queries.filter(q => q.table === 'users').slice(0, 2).map(q => q.where.telegram_id), [ownerA, ownerB],
  'service-role owner selection must preserve both distinct decimal strings')
console.log('✅ Dashboard Tasks synthetic two-owner reads remain distinct across unsafe JS Number collision')

const beforeInvalidRead = queries.length
assert.deepEqual(await taskReader.getDashboardTasks(ownerB + 'suffix'), { ok: true, open: [], completed: [] })
assert.deepEqual(await taskReader.getDashboardTasks('00042'), { ok: true, open: [], completed: [] })
assert.deepEqual(await taskReader.getDashboardTasks('999999999999999999999'), { ok: true, open: [], completed: [] })
assert.equal(queries.length, beforeInvalidRead, 'invalid owner must cause zero privileged reads')

sessionOwner = ownerB
const created = await taskRoute.POST(taskRequest('POST', { text: 'B added task' }))
assert.equal(created.status, 200)
assert.equal(todos.find(t => t.id === created.body.id)?.whatsapp_id, users[ownerB].whatsapp_id)
const ownerBQuery = queries.filter(q => q.table === 'users').at(-1)
assert.equal(ownerBQuery?.where.telegram_id, ownerB, 'POST uses the precise signed-in owner')
sessionOwner = ownerA
const forbidden = await taskRoute.PATCH(taskRequest('PATCH', { id: created.body.id, done: true }))
assert.equal(forbidden.status, 404, 'neighboring authenticated owner cannot complete the other owner task')
assert.equal(todos.find(t => t.id === created.body.id)?.done, false)
sessionOwner = ownerB
const allowed = await taskRoute.PATCH(taskRequest('PATCH', { id: created.body.id, done: true }))
assert.equal(allowed.status, 200)
assert.equal(todos.find(t => t.id === created.body.id)?.done, true)
console.log('✅ Dashboard Tasks synthetic create/update stays scoped to exact owner and task WhatsApp identity')

const beforeInvalidMutation = queries.length
sessionOwner = '42suffix'
assert.equal((await taskRoute.POST(taskRequest('POST', { text: 'must deny' }))).status, 409)
assert.equal((await taskRoute.PATCH(taskRequest('PATCH', { id: 'owner-a-task', done: true }))).status, 409)
sessionOwner = '999999999999999999999'
assert.equal((await taskRoute.POST(taskRequest('POST', { text: 'must deny' }))).status, 409)
assert.equal(queries.length, beforeInvalidMutation, 'invalid owner may not query or mutate any table')
sessionOwner = null
assert.equal((await taskRoute.POST(taskRequest('POST', { text: 'must deny' }))).status, 401)
assert.equal(queries.length, beforeInvalidMutation)
assert.deepEqual(queries.filter(q => q.table === 'users').map(q => typeof q.where.telegram_id), 
  Array(queries.filter(q => q.table === 'users').length).fill('string'),
  'all database owner filters must be exact strings, never rounded JS numbers')
console.log('✅ Dashboard Tasks malformed/oversized owners and missing sessions fail closed before DB')
