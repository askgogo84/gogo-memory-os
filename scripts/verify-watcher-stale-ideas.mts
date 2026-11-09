import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { PostgrestClient } from '@supabase/postgrest-js'

const watchers=readFileSync(new URL('../lib/agent/watchers.ts',import.meta.url),'utf8')
const commands=readFileSync(new URL('../lib/agent/watch-command.ts',import.meta.url),'utf8')
const pulse=readFileSync(new URL('../lib/agent/autonomy-pulse.ts',import.meta.url),'utf8')

assert.match(watchers,/dismissWatcherIdeas/)
assert.match(watchers,/watcher_state_no_longer_available/)
assert.match(watchers,/availability !== 'available'/)
assert.match(commands,/dismissIdeasForWatcherIds/)
assert.match(commands,/await dismissIdeasForWatcherIds\(tg,\[String\(recoveredWatcher\.id\)\]\)/)
assert.match(commands,/update\(\{status:'dismissed'\}\)/)
assert.match(pulse,/surfacableIdeaWatchers/)
assert.match(pulse,/fetchPulseIdeas/)
assert.match(pulse,/\.range\(from,from\+pageSize-1\)/)
assert.match(pulse,/watcherRefs\.length&&!watcherRefs\.some/)
assert.match(pulse,/row\.active===true \|\| state\.triggered===true/)

console.log('watcher stale-idea lifecycle contract passed')

// Execute the actual cleanup helper with the installed PostgREST query builder.
// All requests end in this inert fetch; no database or worker is contacted.
const cleanupStart = commands.indexOf('async function dismissIdeasForWatcherIds(')
const cleanupEnd = commands.indexOf('\nfunction watcherIdentityTokens(', cleanupStart)
assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart)
const cleanupJs = ts.transpileModule(commands.slice(cleanupStart, cleanupEnd), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
type Idea = { id: string; telegram_id: string; status: string; source_refs: {type: string; id: string}[] }
function inertCleanup(seed: Idea[], mode: 'ok'|'read-error'|'write-error' = 'ok') {
  const rows = seed.map(row => ({ ...row }))
  const requests: { method: string; owner: string | null; status: string | null; refs?: unknown }[] = []
  const errors: string[] = []
  const client = new PostgrestClient('https://fixture.invalid/rest/v1', {
    fetch: (async (input: any, init?: any) => {
      const url = new URL(String(input))
      assert.equal(url.origin, 'https://fixture.invalid', 'inert endpoint only')
      const method = String(init?.method || 'GET')
      const owner = url.searchParams.get('telegram_id')
      const status = url.searchParams.get('status')
      const request: typeof requests[number] = { method, owner, status }
      requests.push(request)
      const reply = (body: any, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } })
      if (method === 'GET') {
        if (mode === 'read-error') return reply({ code: 'synthetic', message: 'synthetic read failure' }, 400)
        const filter = url.searchParams.get('source_refs') || ''
        assert.ok(filter.startsWith('cs.'))
        try { request.refs = JSON.parse(filter.slice(3)) }
        catch { return reply({ code: '22P02', message: 'invalid input syntax for type json' }, 400) }
        const ref = (request.refs as any[])[0]
        const matches = rows.filter(row => owner === `eq.${row.telegram_id}` && status === `eq.${row.status}` &&
          row.source_refs.some(item => item.type === ref.type && item.id === ref.id))
        return reply(matches.map(row => ({ id: row.id })))
      }
      assert.equal(method, 'PATCH')
      if (mode === 'write-error') return reply({ code: 'synthetic', message: 'synthetic write failure' }, 400)
      const ids = (url.searchParams.get('id') || '').replace(/^in\.\(|\)$/g, '').split(',')
      const body = JSON.parse(String(init?.body))
      assert.deepEqual(body, { status: 'dismissed' })
      for (const row of rows) if (ids.includes(row.id) && owner === `eq.${row.telegram_id}` && status === `eq.${row.status}`) row.status = 'dismissed'
      return reply(null)
    }) as typeof fetch,
  })
  const context: any = { supabaseAdmin: client, console: { error: (...args: any[]) => errors.push(String(args[0])) } }
  runInNewContext(cleanupJs, context)
  return { run: context.dismissIdeasForWatcherIds as (owner:string,ids:string[])=>Promise<number>, rows, requests, errors }
}
const source = (owner:string,id:string,watcher:string,status='new'): Idea => ({ id, telegram_id: owner, status, source_refs:[{type:'watcher',id:watcher}] })
const serialized = inertCleanup([source('42','owned','watcher-a'),source('43','foreign','watcher-a'),source('42','other','watcher-b'),source('42','old','watcher-a','dismissed')])
assert.equal(await serialized.run('42',['watcher-a','watcher-a']),1,'valid JSONB containment must reach owned stale-idea cleanup')
assert.deepEqual(serialized.rows.map(row=>row.status),['dismissed','new','new','dismissed'])
assert.deepEqual(serialized.requests[0].refs,[{type:'watcher',id:'watcher-a'}])
assert.equal(serialized.requests.length,2,'duplicate watcher IDs are deduplicated')
const escapedId = 'quoted"\\watcher,[]'
const escaped = inertCleanup([source('-42','escaped',escapedId)])
assert.equal(await escaped.run('-42',[escapedId]),1)
assert.deepEqual(escaped.requests[0].refs,[{type:'watcher',id:escapedId}])
const empty = inertCleanup([])
assert.equal(await empty.run('42',[]),0)
assert.equal(empty.requests.length,0)
for (const mode of ['read-error','write-error'] as const) {
  const failed = inertCleanup([source('42','failed','watcher-a')],mode)
  assert.equal(await failed.run('42',['watcher-a']),0)
  assert.equal(failed.rows[0].status,'new')
  assert.equal(failed.requests.length,mode==='read-error'?1:2,'no blind retry after a returned error')
  assert.equal(failed.errors.length,1)
}
console.log('watcher cleanup actual PostgREST JSONB serialization and owner/status containment passed (inert fetch)')
