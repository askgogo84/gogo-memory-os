import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const worker=readFileSync('app/api/cron/autonomous-runs/route.ts','utf8')
const browser=readFileSync('lib/agent/browser-command.ts','utf8')

assert.match(worker,/resumePausedBrowserRun/)
assert.match(worker,/whatsapp_browser_response_timeout/)
assert.match(worker,/mode==='execute'/)
assert.match(worker,/background_resume_claimed:/)
assert.match(worker,/Background Gogo finished/)
assert.match(browser,/export async function resumePausedBrowserRun/)
assert.match(browser,/if\(mode==='execute'\)/)
assert.match(browser,/approval_required/)

console.log('Background secure-browser resume verification passed')


assert.match(worker,/browserResumeCutoff/)
assert.match(worker,/background_browser_resume_expired/)
assert.match(worker,/\.gte\('updated_at',browserResumeCutoff\)/)
assert.match(worker,/continued \$\{taskLabel\}/)
console.log('Stale background browser resurrection guard verified')


// standalone-restore-mutation-control: transpile the actual browser restore
// handler into an inert VM. An expired standalone READ has no commerce parent.
// No provider, browser, network, Vault, DB, payment or real owner is touched.
const restoreStart=browser.indexOf('export async function restoreReadBrowserHandoff(')
const restoreEnd=browser.indexOf('// An overlapping read',restoreStart)
assert.ok(restoreStart>=0&&restoreEnd>restoreStart,'actual restore source boundaries must remain present')
const restoreSource=browser.slice(restoreStart,restoreEnd)
const correctGuard='else if(meta.commerce_parent_id)'
assert.ok(restoreSource.includes(correctGuard),'standalone reads must not inherit commerce-only parent checks')
const previousSource=restoreSource.replace(correctGuard,'else')
assert.notEqual(previousSource,restoreSource,'negative control must restore the historical unconditional parent branch')

type FixtureMeta={mode:string;plan_type?:string;url:string;handoff:{token:string;takeoverUrl:string};commerce_parent_id?:string;comparison_parent_id?:string;browser_safe_to_retry?:boolean}
function inertRestore(source:string,meta:FixtureMeta,telegramId='42'){
  const row:any={id:'synthetic-restore-run',type:'secure_browser',telegram_id:'42',status:'paused',metadata_json:structuredClone(meta)}
  const parentIds:unknown[]=[]
  let browserStarts=0
  let comparisonChecks=0
  const db={from(table:string){
    assert.equal(table,'agent_runs')
    let patch:any=null
    const filters:Array<(data:any)=>boolean>=[]
    const q:any={
      select:()=>q,
      eq:(key:string,value:unknown)=>{filters.push(data=>data[key]===value);return q},
      contains:(key:string,value:any)=>{
        assert.equal(key,'metadata_json');assert.equal(value.handoff.token,'old');return q
      },
      is:(key:string,value:any)=>{
        assert.equal(key,'metadata_json->handoff');assert.equal(value,null);return q
      },
      update:(value:any)=>{patch=value;return q},
      maybeSingle:async()=>{
        if(!filters.every(f=>f(row)))return {data:null,error:null}
        if(patch){Object.assign(row,structuredClone(patch));return {data:{id:row.id},error:null}}
        return {data:structuredClone(row),error:null}
      },
    }
    return q
  }}
  const exports:any={}
  runInNewContext(ts.transpileModule(source,{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{
    exports,URL,Date,console,supabaseAdmin:db,
    permission:async()=> 'read',
    evaluateAgentExecutionPolicy:()=>({allowed:true}),
    require:(name:string)=>{
      if(name==='@/lib/commerce/task')return {readCommerceTask:async(owner:string,parentId:unknown)=>{
        assert.equal(owner,'42');parentIds.push(parentId);return null
      }}
      if(name==='@/lib/commerce/price-comparison')return {assertComparisonChild:async()=>{
        comparisonChecks++;throw Error('comparison_parent_mismatch')
      }}
      if(name==='./browser-handoff-health')return {browserHandoffIsLive:async()=>false}
      if(name==='./provider-browser-handoff')return {
        startProviderBrowserHandoff:async(args:any)=>{
          assert.equal(args.userId,'synthetic-owner-42')
          assert.equal(args.sessionTaskId,row.id)
          assert.equal(args.url,'https://example.test/research')
          browserStarts++
          return {token:'new',takeoverUrl:'https://sb-fixture.vercel.run/?token=new'}
        },
        cancelProviderBrowserHandoff:async()=>{throw Error('unexpected_browser_cancel')},
      }
      throw Error('unexpected external dependency: '+name)
    },
  })
  const actor={userId:'synthetic-owner-42',legacyTelegramId:Number(telegramId),whatsappId:'whatsapp:+15550000042',name:'Fixture'}
  return {row,parentIds,actor,restore:exports.restoreReadBrowserHandoff as (args:any)=>Promise<void>,
    started:()=>browserStarts,comparisonChecks:()=>comparisonChecks}
}
const standaloneMeta:FixtureMeta={
  mode:'read',plan_type:'secure_browser',url:'https://example.test/research',
  handoff:{token:'old',takeoverUrl:'https://sb-fixture.vercel.run/?token=old'},browser_safe_to_retry:true,
}
const old=inertRestore(previousSource,standaloneMeta)
await assert.rejects(()=>old.restore({actor:old.actor,runId:old.row.id}),/commerce_parent_unavailable/,
  'unpatched handler must fail the standalone fixture')
assert.deepEqual(old.parentIds,[undefined],'historical defect requests a nonexistent commerce parent')
assert.equal(old.started(),0)
const standalone=inertRestore(restoreSource,standaloneMeta)
await standalone.restore({actor:standalone.actor,runId:standalone.row.id})
assert.deepEqual(standalone.parentIds,[],'standalone read must not perform an unrelated commerce lookup')
assert.equal(standalone.started(),1,'one fresh handoff resumes the same standalone task')
assert.equal(standalone.row.metadata_json.handoff.token,'new')
const missingParent=inertRestore(restoreSource,{...standaloneMeta,commerce_parent_id:'synthetic-missing-parent'})
await assert.rejects(()=>missingParent.restore({actor:missingParent.actor,runId:missingParent.row.id}),
  /commerce_parent_unavailable/,'commerce-linked read still requires an owned parent')
assert.deepEqual(missingParent.parentIds,['synthetic-missing-parent'])
assert.equal(missingParent.started(),0)
const badComparison=inertRestore(restoreSource,{...standaloneMeta,comparison_parent_id:'synthetic-wrong-parent'})
await assert.rejects(()=>badComparison.restore({actor:badComparison.actor,runId:badComparison.row.id}),
  /comparison_parent_mismatch/,'comparison child cannot bypass its parent assertion')
assert.equal(badComparison.comparisonChecks(),1)
assert.equal(badComparison.started(),0)
const crossOwner=inertRestore(restoreSource,standaloneMeta,'43')
await assert.rejects(()=>crossOwner.restore({actor:crossOwner.actor,runId:crossOwner.row.id}),
  /browser_control_unavailable/,'other owner cannot restore this run')
assert.equal(crossOwner.started(),0)
const linkedOnly=inertRestore(restoreSource,standaloneMeta)
await assert.rejects(()=>linkedOnly.restore({actor:linkedOnly.actor,runId:linkedOnly.row.id,linkedOnly:true}),
  /browser_control_unavailable/,'commerce take-control must reject a standalone run')
assert.equal(linkedOnly.started(),0)
const unsafeMode=inertRestore(restoreSource,{...standaloneMeta,mode:'execute'})
await assert.rejects(()=>unsafeMode.restore({actor:unsafeMode.actor,runId:unsafeMode.row.id}),
  /browser_control_unavailable/,'execute mode may not be restored through read-only entrypoint')
assert.equal(unsafeMode.started(),0)
console.log('PASS: actual standalone browser handoff restores without a fake commerce parent; owner, policy and linked controls remain fenced')
