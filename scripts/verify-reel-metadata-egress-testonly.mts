// TEST ONLY — EXPECTED SECURITY RED on the shipped reel metadata code.
// Loads the original checked-out TypeScript file into a sealed VM with an inert
// fetch stub. It never contacts Instagram, Twilio, private hosts, APIs or users.
// Synthetic final URLs represent possible redirect responses; no real redirect
// endpoint, provider exposure, or customer incident is claimed.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const source=readFileSync('lib/services/reel-saver.ts','utf8')
const compiled=ts.transpileModule(source,{
  fileName:'lib/services/reel-saver.ts',reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true},
})
assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,
  'Original reel-saver source must transpile')
const SAFE_URL='https://www.instagram.com/reel/SYNTHETIC123/'
const PRIVATE_IP='169.254.169.254'
const fakeHtml='<html><head><meta property="og:title" content="Synthetic safe title" /></head><body>fixture</body></html>'

type Call={url:string;init:Record<string,any>}
function isolated(opts:{finalUrl?:string}={}) {
  const calls:Call[]=[]
  const fakeFetch=async (input:any,init:Record<string,any>={})=>{
    calls.push({url:String(input),init})
    return {ok:true,status:200,url:opts.finalUrl||String(input),text:async()=>fakeHtml}
  }
  const mod={exports:{} as Record<string,any>}
  const sandbox={
    module:mod,exports:mod.exports,URL,Date,Promise,AbortController,AbortSignal,
    setTimeout,clearTimeout,console,Buffer,Uint8Array,
    process:{env:{OPENAI_API_KEY:'',TWILIO_ACCOUNT_SID:'',TWILIO_AUTH_TOKEN:''}},
    fetch:fakeFetch,
    btoa(_s:string){throw Error('BLOCKED credential transport')},
    require(name:string){
      if(name==='openai')return {default:class FakeOpenAI {
        constructor(){throw Error('BLOCKED OpenAI initialization')}
      }}
      throw Error('BLOCKED non-test import '+name)
    },
  }
  runInNewContext(compiled.outputText,sandbox,{
    filename:'lib/services/reel-saver.ts',timeout:2000,
  })
  assert.equal(typeof mod.exports.saveReel,'function')
  assert.equal(typeof mod.exports.detectReelUrl,'function')
  assert.equal(typeof mod.exports.detectPlatform,'function')
  return {api:mod.exports,calls}
}
let controls=0,securityPass=0,securityFail=0
async function control(label:string,fn:()=>Promise<void>){
  await fn();controls++;console.log('PASS CONTROL: '+label)
}
async function safety(label:string,fn:()=>Promise<void>){
  try{await fn();securityPass++;console.log('PASS SAFETY: '+label)}
  catch(e:any){securityFail++;console.error('FAIL SAFETY (expected until corrected): '+label+': '+String(e?.message||e))}
}

await control('existing accepted Instagram reel URL stays detectable',async()=>{
  const f=isolated()
  assert.equal(f.api.detectReelUrl('Look: '+SAFE_URL),SAFE_URL)
  assert.equal(f.api.detectPlatform(SAFE_URL),'instagram')
  assert.equal(f.calls.length,0)
})
await control('known Instagram reel with supplied caption does not fetch HTML',async()=>{
  const f=isolated()
  const r=await f.api.saveReel({url:SAFE_URL,userCaption:'Synthetic creator posted a safe reel'})
  assert.equal(r.platform,'instagram')
  assert.equal(f.calls.length,0)
})
await control('bare Instagram reel metadata path uses only inert fetch fixture',async()=>{
  const f=isolated()
  const r=await f.api.saveReel({url:SAFE_URL})
  assert.equal(r.title,'Synthetic safe title')
  assert.equal(f.calls.length,1)
  assert.equal(f.calls[0].url,SAFE_URL)
})
await control('non-Instagram LinkedIn caption never triggers thumbnail metadata read',async()=>{
  const f=isolated()
  const r=await f.api.saveReel({url:'https://www.linkedin.com/posts/fixture',userCaption:'Synthetic LinkedIn note'})
  assert.equal(r.platform,'linkedin')
  assert.equal(f.calls.length,0)
})
await safety('P1 private metadata IP with instagram.com in path must never be fetched',async()=>{
  const f=isolated()
  await f.api.saveReel({url:'https://'+PRIVATE_IP+'/latest/meta-data/instagram.com'})
  assert.equal(f.calls.length,0,'private address was passed to application fetch')
})
await safety('P1 loopback with instagram.com in path must never be fetched',async()=>{
  const f=isolated()
  await f.api.saveReel({url:'http://127.0.0.1/private/instagram.com'})
  assert.equal(f.calls.length,0,'loopback URL was passed to application fetch')
})
await safety('platform classifier must check URL hostname, not substring in path',async()=>{
  const f=isolated()
  assert.equal(f.api.detectPlatform('https://external.example.invalid/path/instagram.com'),'other')
})
await safety('Instagram metadata HTTP requests must not auto-follow unverified redirects',async()=>{
  const f=isolated()
  await f.api.saveReel({url:SAFE_URL})
  assert.equal(f.calls.length,1)
  assert.equal(f.calls[0].init.redirect,'manual','automatic redirect-follow could reach a private destination')
})
await safety('redirected private final destination cannot become accepted reel metadata',async()=>{
  const f=isolated({finalUrl:'http://169.254.169.254/latest/meta-data'})
  const r=await f.api.saveReel({url:SAFE_URL})
  assert.notEqual(r.title,'Synthetic safe title',
    'a synthetic response from a private final URL was accepted as Instagram metadata')
})
await safety('plain HTTP Instagram reel must not fetch metadata over insecure transport',async()=>{
  const f=isolated()
  await f.api.saveReel({url:'http://www.instagram.com/reel/SYNTHETIC123/'})
  assert.equal(f.calls.length,0,'non-HTTPS social URL was fetched by server')
})
console.log('CONTROLS='+controls+' SAFETY_PASS='+securityPass+' SAFETY_FAIL='+securityFail)
if(securityFail)process.exitCode=1
