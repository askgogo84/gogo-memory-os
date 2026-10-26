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


/**
 * Security(P1): exercise the ACTUAL dashboard browser-resume/restore route
 * handlers through an entirely inert CommonJS VM harness. Session identity
 * comes from trusted TEXT; legacy browser actors are numeric. 2^53 + 1
 * must NEVER round into 2^53 before a privileged users lookup.
 *
 * No network, database, Vault, real browser, credentials or real accounts.
 */
const browserOwnerHelpers = await import('../lib/dashboard/browser-run-owner')
const { browserRunOwnerFromSession, browserRunOwnerMatchesRow } = browserOwnerHelpers
assert.equal(browserRunOwnerFromSession('9007199254740992'), null)
assert.equal(browserRunOwnerFromSession('9007199254740993'), null)
assert.deepEqual(browserRunOwnerFromSession('42'), { telegramId: '42', legacyTelegramId: 42 })
assert.deepEqual(browserRunOwnerFromSession('-43'), { telegramId: '-43', legacyTelegramId: -43 })
assert.equal(browserRunOwnerMatchesRow('42', {telegramId:'42',legacyTelegramId:42}), true)
assert.equal(browserRunOwnerMatchesRow('43', {telegramId:'42',legacyTelegramId:42}), false)
assert.equal(browserRunOwnerMatchesRow(42, {telegramId:'42',legacyTelegramId:42}), true)
assert.equal(browserRunOwnerMatchesRow(9007199254740992, {telegramId:'42',legacyTelegramId:42}), false)

let browserDashboardSession: string | null = null
let browserBodyReads = 0
let browserOriginChecks = 0
let browserLookup: Array<{table:string;field:string;value:unknown}> = []
let browserActions: Array<{kind:string;actor:any;runId:string}> = []
let forcedWrongBrowserUser: any = null
const browserRows = new Map<string,any>([
  ['42', {id:'owner-uuid-42',telegram_id:'42',whatsapp_id:'whatsapp:+15550000042',name:'Owner Forty Two'}],
  ['43', {id:'owner-uuid-43',telegram_id:'43',whatsapp_id:'whatsapp:+15550000043',name:'Owner Forty Three'}],
  ['9007199254740992', {id:'synthetic-owner-2pow53',telegram_id:'9007199254740992',whatsapp_id:'whatsapp:+15550000055',name:'Unrelated Owner'}],
])
const browserDb = {
  from(table:string) {
    assert.equal(table, 'users', 'browser entry must fetch only the verified user row')
    let field = '', value: unknown = null
    const query: any = {
      select: () => query,
      eq(key:string, raw:unknown) { field=key; value=raw; browserLookup.push({table,field:key,value:raw}); return query },
      maybeSingle: async () => {
        assert.equal(field,'telegram_id')
        return {data: forcedWrongBrowserUser || browserRows.get(String(value)) || null, error:null}
      },
    }
    return query
  },
}
function loadBrowserDashboardPost(filePath:string): any {
  const code = ts.transpileModule(readFileSync(filePath,'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText
  const exports: any = {}
  const mocks: Record<string,any> = {
    'next/server': {NextResponse:{json:(body:any,options?:{status?:number}) =>
      new Response(JSON.stringify(body),{status:options?.status ?? 200,headers:{'content-type':'application/json'}})}},
    '@/lib/dashboard/session': {getSession:async () =>
      browserDashboardSession === null ? null : {telegramId:browserDashboardSession}},
    '@/lib/dashboard/guard': {verifySameOrigin:() => {browserOriginChecks++;return null}},
    '@/lib/supabase-admin': {supabaseAdmin:browserDb},
    '@/lib/dashboard/browser-run-owner':browserOwnerHelpers,
    '@/lib/agent/browser-command':{
      resumePausedBrowserRun:async ({actor,runId}:any) => {
        browserActions.push({kind:'resume',actor,runId})
        return {runId,status:'paused',text:'synthetic-owned-resume'}
      },
      restoreReadBrowserHandoff:async ({actor,runId}:any) => {
        browserActions.push({kind:'restore',actor,runId})
      },
    },
    '@/lib/agent/secondary-auth-handoff':{resumeSecondaryAuthRun:async () => null},
    '@/lib/vault/credential-store':{listVaultCredentialsForDomain:async () => {throw new Error('Vault must not be touched')}},
  }
  runInNewContext(code, {
    exports, console, URL, Date, String, Number,
    require:(name:string) => {
      assert.ok(Object.hasOwn(mocks,name),'Unexpected browser dashboard import: '+name)
      return mocks[name]
    },
  })
  assert.equal(typeof exports.POST,'function')
  return exports.POST
}
const browserDashboardRoutes = [
  {kind:'resume',handler:loadBrowserDashboardPost('app/api/dashboard/agent/runs/[runId]/resume/route.ts')},
  {kind:'restore',handler:loadBrowserDashboardPost('app/api/dashboard/agent/runs/[runId]/restore-handoff/route.ts')},
]
function resetBrowserDashboard(session: string | null) {
  browserDashboardSession=session; browserLookup=[]; browserActions=[]
  browserBodyReads=0; browserOriginChecks=0; forcedWrongBrowserUser=null
}
async function callBrowserDashboard(handler:any) {
  const request = {json:async () => {browserBodyReads++;return {}}}
  return handler(request,{params:Promise.resolve({runId:'run-fixture'})}) as Promise<Response>
}

for (const {kind,handler} of browserDashboardRoutes) {
  const blockedOwners: Array<string|null> = [
    null, '9007199254740992','9007199254740993',
    '-9007199254740993','9223372036854775808',
    '0','-0','042','+42',' 42 ','42garbage','4.2e1','', '1e2',
  ]
  for (const raw of blockedOwners) {
    resetBrowserDashboard(raw)
    const res = await callBrowserDashboard(handler)
    assert.equal(res.status,raw === null ? 401 : 403,
      kind+' must deny noncanonical or lossy session owner '+JSON.stringify(raw))
    assert.deepEqual(browserLookup,[],kind+' must not query any private owner before precise authentication')
    assert.equal(browserBodyReads,0,kind+' must not read request body before owner validation')
    assert.deepEqual(browserActions,[],kind+' must not access browser/Vault under unsafe identity')
    assert.equal(browserOriginChecks,1,'existing same-origin verification must remain in force')
  }

  for (const id of ['42','43']) {
    resetBrowserDashboard(id)
    const res = await callBrowserDashboard(handler)
    assert.equal(res.status,200,kind+' exact safe owner '+id+' should retain legitimate behavior')
    assert.equal(browserLookup.length,1)
    assert.deepEqual(browserLookup[0],{table:'users',field:'telegram_id',value:id},
      kind+' must filter users by the EXACT persisted session text, not Number')
    assert.equal(browserActions.length,1,kind+' only resumes the current safe owner')
    assert.equal(browserActions[0].kind,kind)
    assert.equal(browserActions[0].actor.userId,'owner-uuid-'+id)
    assert.equal(browserActions[0].actor.legacyTelegramId,Number(id))
    assert.equal(browserActions[0].runId,'run-fixture')
  }

  // Defense in depth against malformed/stale service-role records: an otherwise
  // successful query must not mint a browser actor from a mismatched returned row.
  resetBrowserDashboard('42')
  forcedWrongBrowserUser=browserRows.get('43')
  const mismatch = await callBrowserDashboard(handler)
  assert.equal(mismatch.status,400,kind+' must reject a mismatched looked-up user row')
  assert.deepEqual(browserActions,[],kind+' must not resume another row')
}
console.log('PASS: real dashboard browser resume/restore routes reject 64-bit owner aliases before private I/O')
