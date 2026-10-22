import assert from 'node:assert/strict'
import {existsSync,readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const epoch=Date.parse('2026-10-18T16:00:00Z')
class Clock extends Date{constructor(value?:any){super(value===undefined?epoch:value)}static now(){return epoch}}
const row=()=>[{date:'2026-10-18',base:'USD',quote:'INR',rate:94.93,providers:[{key:'ECB',date:'2026-10-16',rate:94.96},{key:'NRB',date:'2026-10-18',rate:94.92}]}]
function harness(payload:any=row(),status=200,contentType='application/json'){
 let apiCalls=0,searchCalls=0;const requests:any[]=[]
 const fetch=async(url:any,options:any)=>{
  requests.push({url:String(url),options})
  if(String(url).startsWith('https://api.frankfurter.dev/')){apiCalls++;return new Response(JSON.stringify(payload),{status,headers:{'content-type':contentType}})}
  searchCalls++;return new Response(JSON.stringify({results:[{title:'Ordinary public search',content:'Existing cited search result',url:'https://example.com/search'}]}),{headers:{'content-type':'application/json'}})
 }
 const globals={Date:Clock,URL,Map,Set,AbortSignal,TextDecoder,TextEncoder,Response,fetch,console:{...console,error:()=>{}},process:{env:{TAVILY_API_KEY:'inert-test-key'}}}
 const load=(file:string,deps:any={})=>{const exports:any={};runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{...globals,exports,require:(name:string)=>{if(deps[name])return deps[name];throw Error('unexpected dependency '+name)}});return exports}
 const service=existsSync('lib/services/reference-fx.ts')?load('lib/services/reference-fx.ts'):{}
 const web=load('lib/web-search.ts',{'./services/reference-fx':service})
 return{web,service,requests,apiCalls:()=>apiCalls,searchCalls:()=>searchCalls}
}
const failures:string[]=[]
async function check(label:string,fn:()=>Promise<void>){try{await fn();console.log('PASS '+label)}catch(e){failures.push(label+': '+(e instanceof Error?e.message:String(e)))}}
await check('actual search uses fixed public FX API for a simple currency estimate with date source and limitations',async()=>{
 const h=harness(),r=await h.web.searchWebResults('Convert 100 USD to INR')
 assert.equal(h.apiCalls(),1);assert.equal(h.searchCalls(),0);assert.equal(r.length,1)
 assert.match(r[0].url,/^https:\/\/api\.frankfurter\.dev\/v2\/rates\?/);assert.match(r[0].snippet,/9,493|9493/);assert.match(r[0].snippet,/2026-10-18/);assert.match(r[0].snippet,/blended daily reference/i);assert.match(r[0].snippet,/2026-10-16.*2026-10-18/);assert.match(r[0].snippet,/not.*(?:payment|bank|executable)/i)
 const q=new URL(h.requests[0].url);assert.equal(q.searchParams.get('base'),'USD');assert.equal(q.searchParams.get('quotes'),'INR');assert.equal(q.searchParams.has('amount'),false);assert.equal(h.requests[0].options.redirect,'error');assert.equal(h.requests[0].options.cache,'no-store');assert.ok(h.requests[0].options.signal)
})
await check('simple rate and decimal amount forms keep direction and local arithmetic',async()=>{
 for(const [text,expected] of [['USD to INR','94.93'],['exchange rate USD to INR','94.93'],['100.5 USD in INR','9,540.47'],['convert 1,000 USD to INR','94,930']]){const h=harness(),r=await h.web.searchWebResults(text);assert.equal(h.apiCalls(),1,text);assert.ok(r[0].snippet.includes(expected),r[0].snippet)}
})
await check('historical domain-scoped mixed transactional and overlong queries retain existing search behavior',async()=>{
 for(const [text,opts] of [['USD to INR yesterday',{}],['send 100 USD to INR',{}],['buy USD to INR',{}],['USD to INR and transfer it',{}],['USD to INR',{includeDomains:['bank.example']}],['USD to INR',{startDate:'2026-10-16'}],['USD to INR'+ ' '.repeat(500)+' yesterday',{}],['convert -1 USD to INR',{}],['convert 10,00 USD to INR',{}],['USD to XAU',{}],['USD to USD',{}]]){const h=harness();await h.web.searchWebResults(text,opts);assert.equal(h.apiCalls(),0,String(text));assert.equal(h.searchCalls(),1)}
})
await check('wrong pair malformed date future date and stale reference never become a rate or fallback',async()=>{
 for(const patch of [{base:'EUR'},{quote:'EUR'},{date:'2026-10-19'},{date:'2026-10-01'},{date:'2026-02-30'},{rate:0},{rate:-1},{rate:'94.93'},{providers:[]},{providers:[{key:'ECB',date:'2026-10-19',rate:94.9}]}]){const h=harness([{...row()[0],...patch}]),r=await h.web.searchWebResults('USD to INR');assert.equal(r.length,0,JSON.stringify(patch));assert.equal(h.searchCalls(),0)}
})
await check('multiple missing non-JSON error and oversized responses fail closed without a guessed rate',async()=>{
 for(const [body,status,type] of [[[],200,'application/json'],[[...row(),...row()],200,'application/json'],[{error:'quota'},429,'application/json'],[row(),200,'text/html'],[{padding:'x'.repeat(100000)},200,'application/json']]){const h=harness(body,status as number,type as string),r=await h.web.searchWebResults('USD to INR');assert.equal(r.length,0);assert.equal(h.searchCalls(),0)}
})
await check('concurrent same-pair requests share a bounded success read but calculate each amount separately',async()=>{
 const h=harness(),r=await Promise.all([h.web.searchWebResults('10 USD to INR'),h.web.searchWebResults('100 USD to INR')]);assert.equal(h.apiCalls(),1);assert.match(r[0][0].snippet,/949\.3/);assert.match(r[1][0].snippet,/9,493|9493/);await h.web.searchWebResults('USD to INR');assert.equal(h.apiCalls(),1)
})
await check('R33: a trailing ask for the source and observation date keeps the reference route; other extra clauses do not',async()=>{
 for(const text of ['Convert 100 USD to INR and give the source and observation date.','convert 100 usd to inr with the source','USD to INR, and show me the date and source']){const h=harness();const r=await h.web.searchWebResults(text,{});assert.equal(h.apiCalls(),1,text);assert.equal(h.searchCalls(),0,text);assert.match(String(r[0]?.snippet||''),/reference/i)}
 for(const text of ['Convert 100 USD to INR and give the fees','Convert 100 USD to INR and transfer it with the source','Convert 100 USD to INR and give the source and pay it']){const h=harness();await h.web.searchWebResults(text,{});assert.equal(h.apiCalls(),0,text)}
 const h=harness();assert.equal(h.service.isReferenceFxRequest('Convert 100 USD to INR and give the source and observation date.'),true);assert.equal(h.service.isReferenceFxRequest('send 100 USD to INR'),false)
})
await check('the ordinary search text formatter preserves API source and uncertainty',async()=>{
 const h=harness(),text=await h.web.searchWeb('USD to INR');assert.equal(h.apiCalls(),1);assert.match(text,/Source: https:\/\/api\.frankfurter\.dev/);assert.match(text,/reference/i);assert.match(text,/2026-10-18/)
})
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}else console.log('Reference FX actual search entrypoint controls passed; inert transports, not bank/payment quotes or canonical acceptance.')
