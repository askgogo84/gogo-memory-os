import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { runInNewContext } from 'node:vm'
import * as authSummary from '../lib/dashboard/browser-auth-summary'

const activityExports:any={}
runInNewContext(ts.transpileModule(fs.readFileSync('lib/dashboard/agent-activity.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
  {exports:activityExports,require:(name:string)=>name==='./browser-auth-summary'?authSummary:{},URL})
// Live 2 Oct: a new cloud takeover rendered a previous attempt's HTTP 403.
const old403={toolName:'secure_browser',output:{title:'Old provider page',summary:'HTTP 403',blockReason:'provider_access_limited'}}
const resumedRun={status:'paused',summary:'Choose your account or delivery location.',error:null,metadata:{handoff:{takeoverUrl:'https://takeover.example/',providerUrl:'https://www.swiggy.com/instamart'}},steps:[old403]}
const activeBrowser=activityExports.browserContextForRun(resumedRun)
assert.equal(activeBrowser.providerBlocked,false)
assert.equal(activeBrowser.takeoverAvailable,true)
assert.equal(activeBrowser.summary,resumedRun.summary)
assert.equal(activeBrowser.title,'')
const failedBrowser=activityExports.browserContextForRun({...resumedRun,status:'failed',error:'browser_objective_unverified',summary:'No verified result from this attempt.',metadata:{}})
assert.equal(failedBrowser.summary,'No verified result from this attempt.')
assert.equal(failedBrowser.title,'')
assert.equal(activityExports.browserContextForRun({...resumedRun,metadata:{handoff:{mode:'device',providerUrl:'https://www.swiggy.com/instamart'}}}).providerBlocked,true)

const activity=fs.readFileSync('app/dashboard/(app)/activity/page.tsx','utf8')
const detail=fs.readFileSync('app/dashboard/(app)/activity/[runId]/page.tsx','utf8')
const browser=fs.readFileSync('app/dashboard/(app)/activity/[runId]/browser/page.tsx','utf8')
const handoff=fs.readFileSync('app/api/dashboard/agent/runs/[runId]/handoff/route.ts','utf8')
const shot=fs.readFileSync('app/api/dashboard/agent/runs/[runId]/browser-shot/route.ts','utf8')
const side=fs.readFileSync('components/dashboard/dashboard-nav.tsx','utf8')

assert.match(activity,/What Gogo has done, newest first/)
for (const filter of ['Reminders','Browser','Research','Documents']) assert.match(activity,new RegExp(filter),`Activity must expose ${filter} filter`)
assert.match(detail,/Open browser view/)
assert.match(browser,/Blocked by the provider/)
assert.match(browser,/Take control/)
assert.doesNotMatch(browser,/<input[^>]*(?:otp|one-time|code|password|payment)/i,'Activity browser must not collect authentication secrets')

for(const source of [handoff,shot]){
  assert.match(source,/getSession\(\)/)
  assert.match(source,/telegram_id/)
  assert.match(source,/runId/)
}
assert.match(handoff,/providerUrl/)
assert.match(handoff,/takeoverUrl/)
assert.match(shot,/\/shot/)
assert.match(browser,/handoffActive/)
assert.match(browser,/latest\?\.output\?\.browserState\|\|latest\?\.output/)
assert.match(side,/\/dashboard\/activity/)

console.log('Run 5 Activity / Task Detail dashboard contract passed')


// P1 security regression: exercise the REAL browser-shot route (transpiled) with inert auth/DB/fetch.
const shotModule: any = { exports: {} }
const shotPng = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])
const shotToken = 'A'.repeat(32)
const validShotHandoff = 'https://sb-fixture.vercel.run/?token=' + shotToken
let shotOwner: string | null = '123'
let storedOwner = '123'
let shotHandoff: unknown = validShotHandoff
let shotDbError = false
let shotDbCalls = 0
let shotOutboundCalls = 0
let shotResponder: (url: URL, init: any) => Promise<Response> = async () =>
  new Response(shotPng.buffer, { status: 200, headers: { 'content-type': 'image/png' } })
const shotDb: any = {
  from(table: string) {
    assert.equal(table, 'agent_runs')
    shotDbCalls++
    const filters: Record<string, unknown> = {}
    const query: any = {
      select(columns: string) { assert.equal(columns, 'metadata_json'); return query },
      eq(name: string, value: unknown) { filters[name] = value; return query },
      async maybeSingle() {
        assert.equal(filters.id, 'run-fixture')
        assert.equal(filters.telegram_id, String(shotOwner))
        if (shotDbError) return { data: null, error: { message: 'inert read failure' } }
        return { data: filters.telegram_id === storedOwner
          ? { metadata_json: { handoff: { takeoverUrl: shotHandoff } } } : null, error: null }
      },
    }
    return query
  },
}
const shotNextResponse = class extends Response {
  static json(value: unknown, options: any = {}) { return Response.json(value, options) }
}
runInNewContext(
  ts.transpileModule(fs.readFileSync('app/api/dashboard/agent/runs/[runId]/browser-shot/route.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  {
    exports: shotModule.exports, module: shotModule, URL, Response, Uint8Array, AbortSignal,
    require(name: string) {
      if (name === 'next/server') return { NextResponse: shotNextResponse }
      if (name === '@/lib/dashboard/session') return { getSession: async () => shotOwner ? { telegramId: shotOwner } : null }
      if (name === '@/lib/supabase-admin') return { supabaseAdmin: shotDb }
      throw Error('browser-shot fixture unexpected dependency: ' + name)
    },
    fetch: async (url: URL, init: any) => {
      shotOutboundCalls++
      assert.equal(url.origin, 'https://sb-fixture.vercel.run')
      assert.equal(url.pathname, '/shot')
      assert.equal(url.searchParams.get('token'), shotToken)
      assert.equal(init.redirect, 'manual', 'redirects must never be followed')
      assert.equal(init.cache, 'no-store')
      return shotResponder(url, init)
    },
  },
)
const shotRoute: any = shotModule.exports
const shotRequest = async () =>
  shotRoute.GET({} as Request, { params: Promise.resolve({ runId: 'run-fixture' }) }) as Promise<Response>
assert.equal(shotRoute.browserShotUrl(validShotHandoff)?.pathname, '/shot')
assert.equal(shotRoute.browserShotUrl(validShotHandoff)?.searchParams.get('token'), shotToken)
for (const hostile of [
  'http://sb-fixture.vercel.run/?token=' + shotToken,
  'https://127.0.0.1/?token=' + shotToken,
  'https://169.254.169.254/?token=' + shotToken,
  'https://sb-fixture.vercel.run.evil.test/?token=' + shotToken,
  'https://user:pass@sb-fixture.vercel.run/?token=' + shotToken,
  'https://sb-fixture.vercel.run:444/?token=' + shotToken,
  'https://sb-fixture.vercel.run/admin?token=' + shotToken,
  'https://sb-fixture.vercel.run/?token=short',
  'https://sb-fixture.vercel.run/?token=' + shotToken + '&token=' + shotToken,
  'https://sb-fixture.vercel.run/?token=' + shotToken + '&url=http://127.0.0.1/',
  'https://sb-fixture.vercel.run/?token=' + shotToken + '#fragment',
]) assert.equal(shotRoute.browserShotUrl(hostile), null, 'reject untrusted handoff ' + hostile.split('?')[0])
assert.equal(shotRoute.browserShotUrl({ toString: () => validShotHandoff }), null, 'object coercion is not a trusted URL')

shotOwner = null
assert.equal((await shotRequest()).status, 401)
assert.equal(shotDbCalls, 0, 'unauthenticated request performs no private read')
shotOwner = '123'
storedOwner = '456'
assert.equal((await shotRequest()).status, 404)
assert.equal(shotOutboundCalls, 0, 'foreign owner performs no network call')
storedOwner = '123'
shotDbError = true
assert.equal((await shotRequest()).status, 500)
assert.equal(shotOutboundCalls, 0, 'DB read error does not leak screenshot')
shotDbError = false

shotHandoff = 'http://169.254.169.254/?token=' + shotToken
assert.equal((await shotRequest()).status, 400)
assert.equal(shotOutboundCalls, 0, 'hostile persisted handoff does not trigger any network call')
shotHandoff = validShotHandoff

shotResponder = async () => new Response(null, {
  status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' },
})
assert.equal((await shotRequest()).status, 502, 'redirect must be denied')
shotResponder = async () => new Response('<html>not an image</html>', {
  headers: { 'content-type': 'text/html' },
})
assert.equal((await shotRequest()).status, 502, 'HTML from screenshot endpoint is not an image')
shotResponder = async () => new Response(shotPng.buffer, {
  headers: { 'content-type': 'image/png', 'content-length': String(4 * 1024 * 1024 + 1) },
})
assert.equal((await shotRequest()).status, 502, 'oversize Content-Length is denied before reading')
shotResponder = async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), {
  headers: { 'content-type': 'image/png' },
})
assert.equal((await shotRequest()).status, 502, 'oversize streamed content is denied')
shotResponder = async () => new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), {
  headers: { 'content-type': 'image/png' },
})
assert.equal((await shotRequest()).status, 502, 'fake PNG signature is denied')
shotResponder = async () => new Response(shotPng.buffer, {
  headers: { 'content-type': 'image/png' },
})
const allowedShot = await shotRequest()
assert.equal(allowedShot.status, 200, 'valid owner and handoff still have read-only preview')
assert.equal(allowedShot.headers.get('content-type'), 'image/png')
assert.equal(allowedShot.headers.get('cache-control'), 'no-store, max-age=0')
assert.deepEqual(new Uint8Array(await allowedShot.arrayBuffer()), shotPng, 'exact PNG preserved')
console.log('PASS: browser-shot exact-origin, owner, redirects, streamed size and PNG egress controls')
