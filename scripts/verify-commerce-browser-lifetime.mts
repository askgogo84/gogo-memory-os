import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

// Run the actual worker and takeover programs. A cookie-only fixture would miss
// the original defect: each action batch reloaded the page and destroyed its DOM.
export function browserProgram(file:string,name:string){
  const exports:any={}
  const source=readFileSync(new URL('../lib/agent/'+file,import.meta.url),'utf8')+'\nexport { '+name+' }'
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  runInNewContext(code,{exports,process:{env:{}},Buffer,URL,require:(id:string)=>{
    if(id==='@anthropic-ai/sdk')return {default:class {}}
    if(id==='./secure-browser-bootstrap')return {BROWSER_PROFILE_DIR:'/fixture/profile',SANDBOX_WORKDIR:'/fixture'}
    if(id==='./persistent-commerce-browser')return {COMMERCE_CDP_URL:'http://127.0.0.1:9222'}
    return {}
  }})
  return exports[name] as string
}
const worker=browserProgram('secure-computer.ts','BROWSER_SCRIPT')
const handoff=browserProgram('browser-handoff.ts','HANDOFF_SERVER')
const guardContext:any={}
const guardStart=worker.indexOf('async function isConsequentialControl(')
runInNewContext(worker.slice(guardStart,worker.indexOf('(async()=>{',guardStart))+'\nthis.guard=isConsequentialControl;',guardContext)
for(const label of ['Add','Add to cart','Remove','Increase quantity','Decrease quantity','+']){
  const element={textContent:label,id:'',tagName:'BUTTON',getAttribute:(name:string)=>name==='type'?'button':null}
  assert.equal(await guardContext.guard({locator:()=>({first:()=>({evaluate:(fn:any)=>fn(element)})})},'#control'),true,'read must block '+label)
}
let activeTask='',gotoCount=0,contextClosed=0,disconnects=0,launches=0
let currentUrl='about:blank',field='',sessionMarker=''
const page:any={
  url:()=>currentUrl,
  goto:async(url:string)=>{gotoCount++;currentUrl=url;field='';sessionMarker=''},
  waitForTimeout:async()=>{},
  locator:()=>({first:()=>({fill:async(value:string)=>{field=value}})}),
  evaluate:async()=>({url:currentUrl,title:'Fixture',text:field,forms:[],links:[]}),
}
const context={pages:()=>[page],close:async()=>{contextClosed++}}
const chromium={
  connectOverCDP:async(url:string)=>{assert.equal(url,'http://127.0.0.1:9222');return {contexts:()=>[context],close:async()=>{disconnects++}}},
  launchPersistentContext:async()=>{launches++;return context},
}
let handler:any
const fs={readFileSync:()=>activeTask,writeFileSync:(_path:string,value:string)=>{activeTask=value}}
const globals=(argv:string[])=>({
  Buffer,URL,console:{log:()=>{},error:()=>{}},setTimeout:()=>0,
  process:{argv,env:{},exit:(code:number)=>{if(code)throw Error('program_exit_'+code)}},
  require:(name:string)=>name==='playwright'?{chromium}:name==='fs'?fs:name==='url'?{URL}:name==='http'?{createServer:(h:any)=>{handler=h;return {listen:()=>{}}}}:{},
})
const run=(payload:any)=>runInNewContext(worker,globals(['node','worker',Buffer.from(JSON.stringify(payload)).toString('base64')]))
const task={url:'https://provider.example/item',mode:'read',keepAlive:true,taskId:'owned-task',actions:[]}
await run(task)
await run({...task,reusePage:true,actions:[{kind:'fill',selector:'#search',value:'Amul Taaza 1 litre'}]})
sessionMarker='location-selected'
assert.equal(gotoCount,1,'action wave must not reload the page')
await runInNewContext(handoff,globals(['node','handoff','token',Buffer.from(task.url).toString('base64'),Buffer.from(JSON.stringify({keepAlive:true,taskId:task.taskId})).toString('base64')]))
assert.equal(gotoCount,1,'takeover attaches to the same page')
field='user selected saved Home address'
let responseCode=0,responseBody=''
const response:any={writeHead:(code:number)=>{responseCode=code},end:(body:string)=>{responseBody=body}}
await handler({url:'/health',method:'GET',headers:{}},response)
assert.equal(responseCode,403,'readiness requires the current handoff token')
await handler({url:'/health',method:'GET',headers:{'x-gogo-handoff-token':'token'}},response)
assert.equal(responseCode,200)
assert.deepEqual(JSON.parse(responseBody),{ready:true},'readiness must not return provider or authentication data')
await handler({url:'/agent-action?token=token',method:'POST',headers:{}},response)
assert.equal(responseCode,409,'commerce automation waits until the human returns control')
await handler({url:'/release?token=token',method:'POST',headers:{}},response)
assert.equal(responseCode,200)
await run({...task,reusePage:true})
assert.equal(field,'user selected saved Home address')
assert.equal(sessionMarker,'location-selected')
assert.equal(contextClosed,0,'disconnecting worker/takeover must not close the persistent context')
assert.equal(launches,0,'worker and takeover must use the existing browser')
assert.equal(disconnects,4)
activeTask='another-task'
await assert.rejects(()=>run({...task,reusePage:true}),/program_exit_1/)
assert.equal(gotoCount,1,'a mismatched task must not silently navigate or resume')
activeTask=''
await assert.rejects(()=>run({...task,reusePage:true}),/program_exit_1/)
assert.equal(contextClosed,0,'expired live state must not destroy a replacement session')
await run({...task,keepAlive:false})
assert.equal(launches,1)
assert.equal(contextClosed,1,'legacy non-commerce cleanup remains unchanged')
console.log('PASS: actual browser programs retain live page through action waves and takeover; replaced/expired task fails; legacy lifecycle preserved')
