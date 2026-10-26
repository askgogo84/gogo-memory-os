import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  OBSCURA_READ_EXPRESSION, obscuraPilotEligible, explicitPublicRetailSearch, parseObscuraObservation,
  readWithObscura, type ObscuraRequest,
} from '../lib/agent/obscura-public-read'
import { OBSCURA_ARCHIVE_SHA256, OBSCURA_VERSION } from '../lib/agent/obscura-pilot-runtime'
import { isLoginFormPage } from '../lib/agent/browser-evidence'
import { needsBrowserDeliveryLocation } from '../lib/agent/browser-location-gate'

const env = {
  GOGO_OBSCURA_PUBLIC_READ:'1',
  GOGO_OBSCURA_PILOT_HOSTS:'www.example.com,www.flipkart.com,www.zomato.com',
}
const req:ObscuraRequest = {
  userId:'owner-a',url:'https://www.example.com/p?q=book',objective:'What is the page title? Read only.',mode:'read',
}
const flipkart={url:'https://www.flipkart.com/search?q=sony%20headphones',
  objective:'Read-only: compare Sony headphones prices. Do not buy.',
  mode:'read' as const,risk:'low'}
assert.equal(explicitPublicRetailSearch(flipkart),true,
  'a safely scoped user public Flipkart comparison has a path through the actual browser command')
assert.equal(explicitPublicRetailSearch({...flipkart,mode:'execute'}),false)
assert.equal(explicitPublicRetailSearch({...flipkart,approvalAction:'purchase'}),false)
assert.equal(explicitPublicRetailSearch({...flipkart,risk:'high'}),false)
assert.equal(explicitPublicRetailSearch({...flipkart,vaultCredentialId:'vault-token'}),false)
assert.equal(explicitPublicRetailSearch({...flipkart,flow:'provider_booking'}),false)
assert.equal(explicitPublicRetailSearch(flipkart,{handoff:{token:'fixture'}}),false)
assert.equal(explicitPublicRetailSearch(flipkart,{comparison_parent_id:'compare'}),false)
assert.equal(explicitPublicRetailSearch(flipkart,{commerce_parent_id:'commerce'}),false)
assert.equal(explicitPublicRetailSearch(flipkart,{browser_safe_to_retry:false}),false)
assert.equal(explicitPublicRetailSearch({...flipkart,objective:'Read-only: find my account prices'}),false)
assert.equal(explicitPublicRetailSearch({...flipkart,objective:'Read-only: compare prices then login'}),false)
assert.equal(explicitPublicRetailSearch({...flipkart,url:'https://www.flipkart.com/account/orders?q=sony'}),false)
assert.equal(explicitPublicRetailSearch({...flipkart,url:'https://www.flipkart.com/search?q=sony#private'}),false)
assert.equal(explicitPublicRetailSearch({...flipkart,url:'https://www.flipkart.com.evil.test/search?q=sony'}),false)
assert.equal(explicitPublicRetailSearch({...flipkart,url:'https://www.flipkart.com/search?q=sony&access%5Ftoken=abc'}),false)
const commandSource=readFileSync('lib/agent/browser-command.ts','utf8')
assert.match(commandSource,/explicitPublicRetailSearch\(params\.command,runMetadata\)/)
assert.match(commandSource,/await tryObscuraBrowserRead\(/)
assert.match(commandSource,/readDeadline:publicReadDeadline/)
assert.match(commandSource,/reservePasswordHandoff:true,reserveHumanHandoff:true/)

const row = (url=req.url, title='A real research page',
  text='Exact product or restaurant source evidence was observed on this page.',
  inputs: Array<{type:string;name:string;label:string}>=[]) =>
  JSON.stringify({url,title,text,inputCount:inputs.length,forms:[{inputs}]})

// Opt in requires explicit mode, owner-supplied host and unprivileged public URL.
assert.equal(obscuraPilotEligible(req,env),true)
assert.equal(obscuraPilotEligible(req,{}),false)
assert.equal(obscuraPilotEligible(req,{...env,GOGO_OBSCURA_PILOT_HOSTS:''}),false)
assert.equal(obscuraPilotEligible({...req,mode:'draft'},env),false)
assert.equal(obscuraPilotEligible({...req,mode:'execute'},env),false)
assert.equal(obscuraPilotEligible({...req,keepAlive:true},env),false)
assert.equal(obscuraPilotEligible({...req,providerBooking:true},env),false)
assert.equal(obscuraPilotEligible({...req,accountCreation:true},env),false)
assert.equal(obscuraPilotEligible({...req,resumePage:true},env),false)
assert.equal(obscuraPilotEligible({...req,vaultCredentialId:'secret-ref'},env),false)
assert.equal(obscuraPilotEligible({...req,loginCode:'123456'},env),false)
assert.equal(obscuraPilotEligible({...req,bookingOtp:'123456'},env),false)
assert.equal(obscuraPilotEligible({...req,reserveHumanHandoff:true},env),false)
assert.equal(obscuraPilotEligible({...req,reservePasswordHandoff:true},env),false)
assert.equal(obscuraPilotEligible({...req,phoneLogin:{number:'synthetic-only',telegramId:'fixture'}},env),false)
assert.equal(obscuraPilotEligible({...req,bookingPhone:'synthetic-only'},env),false)
assert.equal(obscuraPilotEligible({...req,slotCheck:true},env),false)
assert.equal(obscuraPilotEligible({...req,rehearsal:true},env),false)
assert.equal(obscuraPilotEligible({...req,recoverFlightSearch:true},env),false)
assert.equal(obscuraPilotEligible({...req,keepAliveOwner:'temporary-commerce-owner'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://www.example.com/p?token=private'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://www.example.com/p?api_key=private'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://www.example.com/p?access%5Ftoken=private'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://www.example.com/p?access%255Ftoken=private'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://www.example.com/p?access%25255Ftoken=private'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://www.example.com/p#access_token=private'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://www.example.com/p#book'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://www.example.com/p?postcode=560001'},env),true)

assert.equal(obscuraPilotEligible({...req,url:'http://www.example.com/p'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://example.com/p'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://www.example.com.evil.test/p'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://127.0.0.1/'},env),false)
assert.equal(obscuraPilotEligible({...req,url:'https://metadata.google.internal/'},env),false)

// Only observed, matching-origin page evidence is admitted. Synthetic 200/HTML
// is never authority to complete a booking or manufacture availability/prices.
const stamp=new Date('2026-10-25T12:00:00.000Z')
const hit=parseObscuraObservation(req.url,row(),()=>stamp)
assert.equal(hit?.title,'A real research page')
assert.equal(hit?.runtime,'obscura')
assert.equal(hit?.observedAt,stamp.toISOString())
assert.deepEqual(hit?.forms,[{inputs:[]}])
assert.equal(parseObscuraObservation(req.url,
  JSON.stringify({url:req.url,title:'Page',text:'Valid body but no input metadata'})),null,
  'missing form census cannot be silently assumed to have no login inputs')
assert.equal(parseObscuraObservation(req.url,
  row(req.url,'Member Portal','Welcome. Sign in to your account.',
    [{type:'password',name:'password',label:'Password'}])),null,
  'even a member portal title-only request must not bypass credential input evidence')
const phoneLoginInputs=[{type:'tel',name:'phone',label:'Mobile phone'}]
const phoneLogin={url:req.url,title:'Member Portal',text:'Sign in to your account to continue',
  forms:[{inputs:phoneLoginInputs}]}
assert.equal(isLoginFormPage(phoneLogin),true,
  'observed phone-login field and copy must reach existing auth safety gate')
assert.equal(parseObscuraObservation(req.url,
  row(req.url,phoneLogin.title,phoneLogin.text,phoneLoginInputs)),null,
  'the public observation parser must reject a phone sign-in wall before downstream research')
const locationGate=parseObscuraObservation(req.url,
  row(req.url,'Store','Please enter your delivery address to continue',
    [{type:'text',name:'pincode',label:'Enter delivery pincode'}]))
assert.equal(needsBrowserDeliveryLocation(locationGate),true,
  'real input metadata must reach the established delivery-location gate')
assert.equal(parseObscuraObservation(req.url,
  JSON.stringify({url:req.url,title:'Page',text:'Text',inputCount:25,
    forms:[{inputs:Array.from({length:24},()=>({type:'text',name:'x',label:''}))}]})),null,
  'truncated input enumeration must not claim a complete page assessment')

assert.equal(parseObscuraObservation(req.url,row('https://other.example.com/p')),null)
assert.equal(parseObscuraObservation(req.url,row('https://www.example.com/p?access%5Ftoken=private')),null)
assert.equal(parseObscuraObservation(req.url,row('https://www.example.com/p?access%255Ftoken=private')),null)
assert.equal(parseObscuraObservation(req.url,row('https://www.example.com/p?access%25255Ftoken=private')),null)
assert.equal(parseObscuraObservation(req.url,row('https://www.example.com/p#access_token=private')),null)

assert.equal(parseObscuraObservation(req.url,row('http://www.example.com/p')),null)
assert.equal(parseObscuraObservation(req.url,row('https://www.example.com/login')),null)
assert.equal(parseObscuraObservation(req.url,row(req.url,'Just a moment','Checking your browser')),null)
assert.equal(parseObscuraObservation(req.url,row(req.url,'Access Denied','You do not have permission to access this page')),null,
  'the live observed Zomato title Access Denied can never be mistaken for completed research')
assert.equal(parseObscuraObservation(req.url,row(req.url,'Log in','Sign in')),null)
assert.ok(parseObscuraObservation(req.url,row(req.url,'Page','')), 'title-only observations remain eligible for existing objective assessor')
assert.equal(parseObscuraObservation(req.url,'not json'),null)
assert.equal(parseObscuraObservation(req.url,JSON.stringify({url:req.url,text:'missing title'})),null)
assert.equal(parseObscuraObservation(req.url,row(req.url,'T','x'.repeat(26001))),null)
const twice=JSON.stringify(row())
assert.equal(parseObscuraObservation(req.url,twice)?.title,'A real research page')

// No private secrets, input filling or mutable browser commands are forwarded.
let called=0
const seen:unknown[]=[]
const runner=async (command:any,owner:string)=>{
  called++;seen.push({command,owner});return row()
}
assert.equal((await readWithObscura(req,runner,env))?.runtime,'obscura')
assert.equal(called,1)
assert.equal((seen[0] as any).owner,req.userId)
assert.equal((seen[0] as any).command.url,req.url)
assert.equal((seen[0] as any).command.expression,OBSCURA_READ_EXPRESSION)
assert.equal((seen[0] as any).command.timeoutSeconds,15)
// HTML input type="submit" is inert metadata, not a submission command.
assert.doesNotMatch(OBSCURA_READ_EXPRESSION,
  /\.(?:click|submit|dispatchEvent|setAttribute)\s*\(|\.value\s*=|\b(?:localStorage|sessionStorage|password|token)\b|document\.cookie/i,
  'public observation expression cannot invoke mutation actions or read private browser state')
assert.equal(await readWithObscura({...req,mode:'execute'},runner,env),null)
assert.equal(called,1)
assert.equal(await readWithObscura(req,async()=>{throw Error('canary')},env),null)
assert.equal(await readWithObscura(req,async()=>row('https://evil.example/p'),env),null)

// Runtime install must be fixed-version, SHA verified, no CDN/latest selection,
// no borrowed profile/Vault state, and always disposed.
const runtime=readFileSync('lib/agent/obscura-pilot-runtime.ts','utf8')
assert.equal(OBSCURA_VERSION,'v0.2.5')
assert.match(OBSCURA_ARCHIVE_SHA256,/^[a-f0-9]{64}$/)
assert.match(runtime,/sha256sum -c -/)
assert.doesNotMatch(runtime,/releases\/latest|allow:.*\*/s)
assert.match(runtime,/persistent: false/)
assert.match(runtime,/sandbox\.stop\(\)/)
assert.doesNotMatch(runtime,/GOGO_BROWSER_PROXY_PASSWORD|GITHUB_TOKEN|VERCEL_TOKEN|vaultCredential|cookieJar/)
const computer=readFileSync('lib/agent/secure-computer.ts','utf8')
assert.match(computer,/obscuraPilotEligible\(params\)/)
assert.match(computer,/assessReadOutcome\(params\.objective,page\)/)
assert.match(computer,/if \(verified\) return/)
assert.match(computer,/forms:candidate\.forms/,'the actual browser calls existing gates with real input metadata')
assert.match(computer,/let publicFlightRead=false/)
assert.match(computer,/pilotDeadline=Math.min\(Date.now\(\)\+75_000,readDeadline-90_000\)/)
assert.match(computer,/sandboxName:''/)
assert.doesNotMatch(computer,/sandboxName:'obscura-ephemeral-read'/)

console.log('Obscura public-read pilot: opt-in, no credential/action authority, provenance, fallback and disposal checks PASS')
