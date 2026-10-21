import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { evaluateAgentSentinel } from '../lib/agent/sentinel'
import * as sentinel from '../lib/agent/sentinel'
import { browserPageAllowlist } from '../lib/agent/browser-page-network'

// Inert exact-source boundary probes: no browser, DNS, provider or credentials.
const source=readFileSync('lib/agent/secure-computer.ts','utf8')
const api:any={}
runInNewContext(ts.transpileModule(source+'\nexport {allowedHosts,observedReadActions}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:api,URL,Buffer,process:{env:{}},console,
 require:(name:string)=>name==='./browser-page-network'?{browserPageAllowlist}:name==='./sentinel'?sentinel:name==='./browser-proxy'?{resolveBrowserProxy:()=>null,proxyAllowlistHost:()=>null}:{},
})
let passed=0;const failures:string[]=[]
function test(name:string,fn:()=>void){try{fn();passed++;console.log('PASS '+name)}catch(e){failures.push(name+': '+String(e));console.error('FAIL '+name)}}
const input={capability:'browser' as const,mode:'read' as const,risk:'low' as const,irreversible:false,approved:false}
for(const url of ['http://[::ffff:127.0.0.1]/','http://[::ffff:a9fe:a9fe]/','http://127.1/','http://2130706433/','http://localhost./','http://sub.localhost/','http://fixture.internal/','http://metadata/','http://intranet/','https://fixture:dummy@example.com/']){
 test('sentinel rejects '+url,()=>assert.equal(evaluateAgentSentinel({...input,url}).allowed,false))
 test('executor rejects '+url,()=>assert.throws(()=>api.allowedHosts(url)))
 test('allowlist rejects '+url,()=>assert.throws(()=>browserPageAllowlist(url)))
}
test('public target remains usable',()=>{
 assert.equal(evaluateAgentSentinel({...input,url:'https://example.com/search?q=tea'}).allowed,true)
 assert.ok(api.allowedHosts('https://example.com/').allow['example.com'])
})
const page={url:'https://example.com/',links:[],forms:[],controls:[]}
function navigation(url:string,snapshot:any=page){return api.observedReadActions([{kind:'goto',url}],snapshot)}
test('reject invented same-domain leak destination',()=>assert.equal(navigation('https://collect.example.com/leak?data=synthetic').length,0))
test('reject invented same-host path',()=>assert.equal(navigation('https://example.com/leak?data=synthetic').length,0))
test('exact observed legitimate link works',()=>assert.equal(navigation('https://example.com/result?item=tea',{...page,links:[{href:'https://example.com/result?item=tea'}]}).length,1))
test('relative observed legitimate link works',()=>assert.equal(navigation('https://example.com/result',{...page,links:[{href:'/result'}]}).length,1))
test('changed observed query is rejected',()=>assert.equal(navigation('https://example.com/result?item=private',{...page,links:[{href:'https://example.com/result?item=tea'}]}).length,0))
test('observed private link never authorizes navigation',()=>assert.equal(navigation('http://[::ffff:127.0.0.1]/',{...page,links:[{href:'http://[::ffff:127.0.0.1]/'}]}).length,0))
test('observed userinfo never authorizes navigation',()=>assert.equal(navigation('https://fixture:dummy@example.com/',{...page,links:[{href:'https://fixture:dummy@example.com/'}]}).length,0))
test('standalone refresh still works',()=>assert.equal(navigation(page.url).length,1))
test('safe observed search control still works',()=>assert.equal(api.observedReadActions([{kind:'fill',selector:'#q',value:'tea'}],{...page,controls:[{selector:'#q',tag:'input'}]}).length,1))
test('rejected navigation never dispatches later guessed action',()=>assert.equal(api.observedReadActions([{kind:'goto',url:'https://example.com/leak'},{kind:'fill',selector:'#q',value:'private'}],{...page,controls:[{selector:'#q',tag:'input'}]}).length,0))
console.log('Browser URL boundary groups: '+passed+'/'+(passed+failures.length))
if(failures.length)throw Error(failures.join('\n'))
