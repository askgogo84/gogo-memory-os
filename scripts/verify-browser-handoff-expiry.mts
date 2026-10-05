import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {browserHandoffIsLive} from '../lib/agent/browser-handoff-health'

const originalFetch = globalThis.fetch
const observed: string[] = []
const handoff = 'https://sb-example.vercel.run/?token=fixture-only'
try {
  globalThis.fetch = async (input: RequestInfo | URL) => {
    observed.push(String(input))
    return new Response(JSON.stringify({ready: true}), {status: 200})
  }
  assert.equal(await browserHandoffIsLive(handoff), true)
  assert.equal(new URL(observed[0]).pathname, '/health')
  assert.equal(new URL(observed[0]).searchParams.get('token'), 'fixture-only')
  assert.equal(await browserHandoffIsLive('http://sb-example.vercel.run/?token=x'), false)
  assert.equal(await browserHandoffIsLive('https://sb-example.vercel.run.evil.test/?token=x'), false)
  assert.equal(await browserHandoffIsLive('https://example.com/?token=x'), false)
  assert.equal(await browserHandoffIsLive('https://sb-example.vercel.run/'), false)
  assert.equal(observed.length, 1, 'untrusted URLs must never be fetched')

  globalThis.fetch = async () => new Response('sandbox stopped', {status: 410})
  assert.equal(await browserHandoffIsLive(handoff), false, 'stopped sandbox is not actionable')
  globalThis.fetch = async () => { throw new Error('connection refused') }
  assert.equal(await browserHandoffIsLive(handoff), false, 'unreachable sandbox is not actionable')
} finally { globalThis.fetch = originalFetch }
console.log('PASS: live handoff probe and stopped/untrusted sandbox rejection')

// Exercise the actual restore function with a saved Zepto child: an expired
// sandbox gets a new handoff on the SAME row, while a live one is untouched.
const commandSource = readFileSync(new URL('../lib/agent/browser-command.ts', import.meta.url), 'utf8')
const start = commandSource.indexOf('export async function restoreReadBrowserHandoff(')
const end = commandSource.indexOf('// An overlapping read', start)
assert.ok(start >= 0 && end > start)
const program = ts.transpileModule(commandSource.slice(start, end),
  {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText
let live = false, created = 0, parentChecks = 0
const row: any = {id: 'child-zepto', telegram_id: '42', type: 'secure_browser', status: 'paused',
  metadata_json: {mode: 'read', url: 'https://www.zepto.com/', commerce_parent_id: 'parent',
    handoff: {token: 'old-token', takeoverUrl: handoff}}}
const db = {from(table: string) {
  assert.equal(table, 'agent_runs')
  let patch: any
  const filters: Array<(value: any) => boolean> = []
  const query: any = {
    select: () => query,
    eq: (key: string, value: any) => { filters.push(item => item[key] === value); return query },
    contains: (key: string, value: any) => {assert.equal(key, 'metadata_json'); filters.push(item => item.metadata_json?.handoff?.token === value.handoff.token); return query},
    is: (key: string, value: any) => {assert.equal(key, 'metadata_json->handoff'); filters.push(item => item.metadata_json?.handoff === value); return query},
    update: (value: any) => {patch = value; return query},
    maybeSingle: async () => {
      if (!filters.every(filter => filter(row))) return {data: null, error: null}
      if (patch) Object.assign(row, structuredClone(patch))
      return {data: structuredClone(row), error: null}
    },
  }
  return query
}}
const exports: any = {}
runInNewContext(program, {exports, Date, URL, console, require: (name: string) => {
  if (name === '@/lib/commerce/task') return {readCommerceTask: async () => ({metadata_json: {state: 'browser_research', browser_runs: {zepto: row.id}}})}
  if (name === '@/lib/commerce/price-comparison') return {assertComparisonChild: async () => {parentChecks++}}
  if (name === './browser-handoff-health') return {browserHandoffIsLive: async () => live}
  if (name === './provider-browser-handoff') return {
    startProviderBrowserHandoff: async (options: any) => {
      assert.equal(options.userId, row.metadata_json.commerce_parent_id || row.metadata_json.comparison_parent_id ? 'owner-uuid:commerce' : 'owner-uuid')
      assert.equal(options.sessionTaskId, row.id)
      assert.equal(options.navigateToInitial, true, 'restores must return to the requested page without discarding the saved browser context')
      assert.equal(options.keepAlive, row.metadata_json.commerce_parent_id || row.metadata_json.comparison_parent_id ? true : undefined)
      created++; return {token: 'new-token', takeoverUrl: handoff, releaseUrl: handoff.replace('/?', '/release?')}
    },
    cancelProviderBrowserHandoff: async () => {throw Error('unexpected_cancel')},
  }
  throw Error('unexpected_import:' + name)
}, supabaseAdmin: db, permission: async () => 'read', evaluateAgentExecutionPolicy: () => ({allowed: true})})
const restore = exports.takeControlOfCommerceRead as (params: any) => Promise<void>
const restoreRead = exports.restoreReadBrowserHandoff as (params: any) => Promise<void>
const actor = {userId: 'owner-uuid', legacyTelegramId: 42}
await restore({actor, runId: row.id})
assert.equal(created, 1)
assert.equal(row.status, 'paused')
assert.equal(row.id, 'child-zepto')
assert.equal(row.metadata_json.handoff.token, 'new-token')
live = true
await restore({actor, runId: row.id})
assert.equal(created, 1, 'a live takeover must be reused')
await assert.rejects(() => restore({actor: {...actor, legacyTelegramId: 43}, runId: row.id}), /browser_control_unavailable/)
assert.equal(created, 1, 'another owner cannot restore the browser')
row.metadata_json = {...row.metadata_json, commerce_parent_id: undefined, comparison_parent_id: 'comparison'}
live = false
await restore({actor, runId: row.id})
assert.equal(parentChecks, 1, 'a comparison child must retain its parent')
assert.equal(created, 2)
row.metadata_json = {plan_type: 'secure_browser', mode: 'read', url: 'https://example.com/search', handoff: {token: 'old-token', takeoverUrl: handoff}}
row.status = 'paused'
await restoreRead({actor, runId: row.id})
assert.equal(created, 3, 'a standalone read can restore its own expired browser')
assert.equal(row.metadata_json.handoff.token, 'new-token')
await assert.rejects(() => restore({actor, runId: row.id}), /browser_control_unavailable/, 'commerce action cannot take over a standalone task')
row.metadata_json.mode = 'execute'
await assert.rejects(() => restoreRead({actor, runId: row.id}), /browser_control_unavailable/, 'execute tasks need their approved resume path')
row.metadata_json.mode = 'draft'
await assert.rejects(() => restoreRead({actor, runId: row.id}), /browser_control_unavailable/, 'draft tasks are not read-only')
row.metadata_json.mode = 'read'
row.metadata_json.browser_safe_to_retry = false
await assert.rejects(() => restoreRead({actor, runId: row.id}), /browser_control_unavailable/, 'possible prior provider action cannot be replayed')
row.metadata_json.browser_safe_to_retry = true
row.status = 'completed'
await assert.rejects(() => restoreRead({actor, runId: row.id}), /browser_control_unavailable/, 'standalone terminal runs stay terminal')
row.status = 'paused'
row.metadata_json.url = 'http://localhost/admin'
await assert.rejects(() => restoreRead({actor, runId: row.id}), /browser_control_unavailable/, 'private host cannot be opened')
assert.equal(created, 3)
console.log('PASS: expired commerce and standalone read handoffs restore only the same owned safe task')
