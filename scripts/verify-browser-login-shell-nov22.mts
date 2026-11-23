// Synthetic-only browser auth evidence gate. Never opens a browser or uses a real account.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {isBrowserLoginShell,isBrowserRegistrationBarrier} from '../lib/agent/browser-evidence'

const instagramLogin={
  url:'https://www.instagram.com/accounts/login/?next=%2Fp%2Fexample',
  title:'Log in • Instagram',
  text:'Instagram Log in Sign up Forgot password? About Help Privacy Terms',
}
assert.equal(isBrowserLoginShell(instagramLogin),true,'a redirected Instagram login must pause')
const combinedInstagramGate={
  url:'https://www.instagram.com/p/example',title:'Instagram',
  text:'Instagram Please log in or sign up to see photos and videos from friends. Sign up. About Help Privacy Terms',
}
assert.equal(isBrowserLoginShell(combinedInstagramGate),true,
  'a combined log-in-or-sign-up gate is not public post evidence')
const combinedGenericGate={
  url:'https://example.com/post/42',title:'Example',
  text:'Log in or sign up to view this post. Create an account to continue.',
}
assert.equal(isBrowserLoginShell(combinedGenericGate),true,
  'combined auth prompts also block other providers')
const accountCreationShell={
  url:'https://www.instagram.com/p/example',title:'Instagram',
  text:'Log in to view this post. Create an account to see more photos and videos. Sign up. About Help Privacy Terms',
}
assert.equal(isBrowserLoginShell(accountCreationShell),true,
  'account-creation promotion after login does not establish readable post evidence')

const signupOnlyInstagramShell={
  url:'https://www.instagram.com/p/example', title:'Instagram',
  text:'Instagram Sign up to see photos and videos from friends. Sign up. About Help Press Privacy Terms',
}
assert.equal(isBrowserLoginShell(signupOnlyInstagramShell),true,
  'signup-only marketing copy must not be considered public Instagram post evidence')
const signupRouteShell={
  url:'https://www.instagram.com/accounts/emailsignup/',title:'Sign up • Instagram',text:'Instagram',
}
assert.equal(isBrowserLoginShell(signupRouteShell),true,
  'Instagram registration destination is an auth boundary before controls render')
const genericSignupForm={
  url:'https://example.com/register',title:'Create an account',
  text:'Sign up to continue',forms:[{inputs:[{name:'email',type:'email'},{name:'password',type:'password'}]}],
}
assert.equal(isBrowserLoginShell(genericSignupForm),true,
  'credential-bearing registration form is an auth boundary without login copy')
// A registration barrier can pause an auth-requiring task but must never be
// passed to the separate saved-credential login script. No provider I/O.
assert.equal(isBrowserRegistrationBarrier(genericSignupForm),true,
  'registration form must not authorize automatic Vault login')
assert.equal(isBrowserRegistrationBarrier(signupRouteShell),true,
  'empty Instagram registration route must not authorize Vault login')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/create-account',title:'Join',text:'Register',forms:[],
}),true,'an active account-creation URL is blocked even before form hydration')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/auth',title:'Create account',text:'Welcome',
  forms:[{inputs:[{name:'email',type:'email'}]}],
}),true,'email-first registration must stop before clicking Next or creating an account')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/auth',title:'Welcome',text:'Sign up to continue',
  forms:[{inputs:[{name:'email',type:'email'}]}],
}),true,'first-step registration copy and an email field cannot authorize Vault')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/auth',title:'Welcome',
  text:'Home Products Help Create account Continue. Already have an account? Log in',
  forms:[{action:'https://example.com/auth',inputs:[{name:'email',type:'email'}]}],
  controls:[{tag:'button',label:'Continue — Create account'},{tag:'a',label:'Log in'}],
}),true,'visible implicit registration submit blocks Vault before any credential resolution')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/help/auth',title:'Welcome',
  text:'Home Help Create account Email Continue. Already have an account? Log in',
  forms:[{action:'https://example.com/help/auth',inputs:[{name:'email',type:'email'}],submitLabels:['Continue']}],
  controls:[{tag:'button',label:'Continue',inForm:true}],
}),true,'a real help-hosted registration form must not be exempted as public documentation')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/auth',title:'Welcome',
  text:'Home Product Register new users Log in',
  forms:[{action:'https://example.com/auth',inputs:[{name:'email',type:'email'}],submitLabels:['Sign up']}],
  controls:[{tag:'button',label:'Sign up',inForm:true}],
}),true,'form-associated Sign up control must stop backend Vault lookup without an Already have account cue')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/help/auth',title:'Welcome',
  text:'Home Help Sign up Log in',
  forms:[{action:'https://example.com/help/auth',inputs:[{name:'email',type:'email'}],submitLabels:['Sign up'],formText:'Sign up Email'}],
  controls:[{tag:'button',label:'Sign up',inForm:true}],
}),true,'help-hosted email-first account Sign up submit blocks Vault even with no Already have account copy')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/guides/signup',title:'Public guide',
  text:'Sign up to see photos and videos from friends. Here is the public guide.',
  forms:[{action:'https://example.com/guides/signup',inputs:[{name:'newsletterEmail',type:'email'}],submitLabels:['Sign up'],formText:'Sign up for newsletter'}],
  controls:[{tag:'button',label:'Sign up',inForm:true}],
}),false,'public guide newsletter Sign up is not an account creation form')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/auth',title:'Welcome',
  text:'Home Create account Email Subscribe to newsletter',
  forms:[{action:'https://example.com/auth',inputs:[{name:'email',type:'email'}],
    submitLabels:['Sign up'],formText:'Create account Email Subscribe to newsletter'}],
  controls:[{tag:'button',label:'Sign up',inForm:true}],
}),true,'email-first account signup with optional newsletter opt-in still blocks Vault')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/auth',title:'Welcome',
  text:'Home Sign up Email Log in',
  forms:[{action:'https://example.com/auth',inputs:[
    {name:'email',type:'email'},{name:'newsletter',type:'checkbox'}],
    submitLabels:['Sign up'],formText:'Sign up Email Subscribe to newsletter'}],
}),true,'optional newsletter checkbox cannot hide an account registration headed Sign up')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/guides/auth',title:'Welcome',
  text:'Home Sign up Email Log in',
  forms:[{action:'https://example.com/guides/auth',inputs:[{name:'email',type:'email'}],
    submitLabels:['Sign up'],formText:'Sign up Email'}],
}),true,'a guide URL without newsletter evidence cannot exempt a real account signup')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/login',title:'Sign in',
  text:'Sign in. Subscribe for updates.',
  forms:[
    {action:'https://example.com/login',inputs:[{name:'email',type:'email'},{name:'password',type:'password'}],submitLabels:['Log in'],formText:'Log in'},
    {action:'https://example.com/subscribe',inputs:[{name:'newsletterAddress',type:'email'}],submitLabels:['Sign up'],formText:'Newsletter Sign up'}],
}),false,'footer newsletter signup cannot convert a separate existing-account login into registration')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/login',title:'Sign in',text:'Sign in to your account',
  forms:[{action:'https://example.com/login',inputs:[{name:'email',type:'email'},{name:'password',type:'password'}]}],
  controls:[{tag:'a',label:'Sign up'},{tag:'button',label:'Log in'}],
}),false,'signup navigation link beside a real login form is not account creation')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/auth',title:'Welcome',
  text:'Home Products Help Create account Email Continue Already have an account? Log in',
  forms:[{action:'https://example.com/auth',inputs:[{name:'email',type:'email'}]}],
  controls:[{tag:'button',label:'Continue'},{tag:'a',label:'Log in'}],
}),true,'signup heading with a generic Continue must block saved credentials before the worker')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/login',title:'Sign in',
  text:'Sign in to your account. New here? Sign up.',
  forms:[{action:'https://example.com/login',inputs:[{name:'email',type:'email'},{name:'password',type:'password'}]}],
  controls:[{tag:'button',type:'button',label:'Sign up'},{tag:'button',label:'Log in'}],
}),false,'header Signup navigation button must not make a legitimate login page registration')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/login',title:'Sign in',text:'Sign in to your account. New here? Sign up.',
  forms:[{action:'https://example.com/login',inputs:[{name:'email',type:'email'},{name:'password',type:'password'}]}],
}),false,'an actual login form with incidental sign-up navigation remains eligible for Vault')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://www.instagram.com/p/example',title:'Instagram',
  text:'Instagram Sign up to see photos and videos from friends. About Help',
}),true,'an Instagram sign-up-only gate cannot trigger Vault login')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/guides/signup',title:'Public registration guide',
  text:'Sign up to see photos and videos from friends: our public guide discusses this phrase.',
}),false,'quoted public signup content does not become a credential action')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/guides/signup',title:'Public registration guide',
  text:'Sign up to see photos and videos from friends: this is documentation.',
  forms:[{action:'https://example.com/guides/signup',inputs:[{name:'newsletterEmail',type:'email'}]}],
}),false,'a public guide with a newsletter form is not a registration route or credential action')
assert.equal(isBrowserRegistrationBarrier({
  url:'https://example.com/login',title:'Sign in',text:'Log in',
  forms:[{action:'https://example.com/register',inputs:[{name:'email',type:'email'},{name:'password',type:'password'}]}],
}),true,'a registration-targeted password form is not made safe by a sign-in title')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example', title:'Public brand post',
  text:'Instagram Sign up to see photos and videos from friends. brandname New product launch today. November 22 About Help Press Privacy Terms',
}),false,'real unlabelled caption beneath a signup-only banner remains readable')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Public short caption',
  text:'Instagram Sign up to see photos and videos from friends. brandname Coming soon. About Help Press Privacy Terms',
}),false,'short unlabelled public caption is not hidden by a signup banner')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Instagram',
  text:'Instagram Sign up to see this post. Create your account to see more posts. Sign up. About Help Privacy Terms',
}),true,'signup-only registration marketing is not a real short caption')
assert.equal(isBrowserLoginShell({
  url:'https://example.com/guides/signup',title:'Registration guide',
  text:'Sign up to see photos and videos from friends: this is the notice displayed on Instagram. This public guide explains the signup process.',
}),false,'public guide beginning with signup-only words is not an active gate')
assert.equal(isBrowserLoginShell({
  url:'https://example.com/guides/signup',title:'How registration works',
  text:'Our article explains why sites ask visitors to sign up to see a post. It is a public guide, not an active login gate.',
  forms:[{inputs:[{type:'email',name:'newsletterEmail'}]}],
}),false,'public signup guidance and newsletter fields without passwords remain readable')

assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Public post',
  text:'Instagram Log in or sign up to view this post. brandname New product launch today. 38 likes. About Help Press',
}),false,'an auth banner above a genuinely observed post must not hide caption and likes')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Public post',
  text:'Instagram Log in or sign up to view this post. brandname New product launch today. November 22 About Help Press Privacy Terms',
}),false,'an unlabelled public caption beneath a combined banner remains readable')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Instagram',
  text:'Instagram Please log in or sign up to see photos and videos from your friends. Sign up About Help Privacy Terms',
}),true,'stock sign-in marketing words alone must not count as post copy')

assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Public caption',
  text:'Instagram Log in or sign up to view this post. Caption: New product launch today. About Help Press',
}),false,'an observed caption remains readable even below a combined sign-in prompt')


assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Instagram',
  text:'Instagram\nLog in\nSign up\nAbout\nHelp\nPress\nAPI\nJobs\nPrivacy\nTerms\nLocations',
}),true,'footer-only signed-out Instagram view cannot answer a post research task')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/reel/example',title:'Instagram',
  text:'Log in to see photos and videos from friends. Sign up. About Help',
}),true,'an explicit signed-out content gate must pause')
assert.equal(isBrowserLoginShell({
  url:'https://example.com/login',title:'Sign in',text:'Username Password',
}),true,'generic login destinations must pause')
assert.equal(isBrowserLoginShell({
  url:'https://example.com/account',title:'Your account',
  text:'Sign in to view this post',
}),true,'explicit gated content is not research completion')
assert.equal(isBrowserLoginShell({
  url:'https://example.com/products/headphones',title:'Headphones product detail',
  text:'Headphones are ₹2499 and available in blue. Log in. Sign up. Help and About us.',
}),false,'a normal public page with sign-in navigation remains readable')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Public post',
  text:'Caption: New product launch today. 38 likes. Log in Sign up About Help Press',
}),false,'a genuinely visible Instagram post with caption/likes is not a footer-only shell')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Public post',
  text:'Caption: New product launch today. Log in Sign up About Help Press',
}),false,'a public caption without likes is still visible research evidence')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Public brand post',
  text:'Log in Sign up brandname New product launch today. November 22 About Help Press Privacy Terms',
}),false,'unlabelled Instagram caption is real readable page content')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Public Hindi post',
  text:'Log in Sign up brandname नया उत्पाद आज उपलब्ध है। हमारी पूरी जानकारी यहाँ पढ़ें। About Help Press Privacy Terms',
}),false,'Unicode Hindi caption is visible public evidence, not a sign-in shell')
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example',title:'Public CJK post',
  text:'Log in Sign up 新製品を本日発表しました詳細はこちらをご覧ください About Help Press Privacy Terms',
}),false,'unspaced Unicode caption should not disappear into ASCII-only footer normalization')
assert.equal(isBrowserLoginShell({
  url:'https://example.com/articles/authentication',title:'A guide to passkeys',
  text:'Our article discusses why many sites use a Sign in link, but this is public article text.',
}),false,'incidental authentication references must not trigger a handoff')
assert.equal(isBrowserLoginShell({
  url:'https://example.com/guides/instagram-auth',title:'How public sign-in pages work',
  text:'This public guide quotes the phrase "Log in or sign up to see photos and videos" while explaining authentication.',
}),false,'a quoted combined sign-in prompt is not an active page gate')

assert.equal(isBrowserLoginShell({
  url:'https://example.com/guides/auth',title:'A guide to passkeys',
  text:'For protected content, users must sign in to continue. This public guide explains the sign-in flow and available authentication options.',
}),false,'a quoted instruction is not an active sign-in gate')

// Assert that the actual browser entry points use this pure gate, not just the test fixture.
const source=readFileSync(new URL('../lib/agent/secure-computer.ts',import.meta.url),'utf8').replace(/\r\n/g,'\n')
const assessor=source.slice(source.indexOf('export async function assessReadOutcome('))
assert.match(assessor.slice(0,650),/if\(isBrowserLoginShell\(page\)\|\|/,
  'read assessor must reject login shells before model or title-only completion')
assert.match(assessor.slice(0,650),/typeof detectHumanAuthGate==='function'&&detectHumanAuthGate\(page\)\.required/,
  'actual auth gates still refuse verification when the gate exists; old VM harness stubs remain valid')
assert.match(source,/function pageLooksLikeLogin\(page:any\)\{\s*return isBrowserLoginShell\(page\)/,
  'the same-run auth handoff must recognize signed-out shells')
// Both layers must refuse account creation before any Vault lookup, field fill,
// generic Continue or generic submit (the second layer covers redirects).
assert.match(source,/const registrationBarrier=isBrowserRegistrationBarrier\(page\)/,
  'the runtime must classify a separate registration barrier')
assert.match(source,/if\(registrationBarrier&&params\.accountCreation!==true&&!publicInstagramEvidence\)\{/,
  'unapproved registration must hand off before the planner or Vault')
const registrationStop=source.slice(source.indexOf('if(registrationBarrier&&params.accountCreation!==true'),source.indexOf('let signedOutEntry='))
assert.match(registrationStop,/blockReason:'human_auth_required',authReason:'login_unavailable'/,
  'registration must preserve the original task through a human auth handoff')
assert.match(source,/const publicInstagramEvidence=params\.mode==='read'&&!loginish/,
  'a visible Instagram post can remain readable without permitting a saved login')
const vaultRefusal=source.slice(source.indexOf('const vaultFill=page?.vaultLogin||{}'),source.indexOf('if(!vaultFill.usernameFilled)'))
assert.match(vaultRefusal,/if\(vaultFill\.registrationRefused===true\)\{/,
  'post-redirect worker refusal must stop before login success or session recording')
assert.match(vaultRefusal,/blockReason:'human_auth_required',authReason:'login_unavailable'/,
  'worker refusal must hand off to a human instead of reporting login success')

assert.match(source,/if\(!params\.publicOnly && !vaultAttempted && params\.accountCreation!==true && \(authGate\.reason==='password'\|\|\(!authGate\.required&&\(loginish\|\|signedOutEntry\)\)\) && !registrationBarrier && !publicGuideRead/,
  'credential lookup must be unreachable from registration and public guide reads')
assert.match(source,/const publicGuideRead=params\.mode==='read'&&!loginish/,
  'public guides/newsletter forms may not trigger a stored Vault login')
const vaultWorker=source.slice(source.indexOf('const VAULT_LOGIN_SCRIPT=String.raw'),source.indexOf("// 16 Oct: the person's sign-in code"))
assert.match(vaultWorker,/const registrationSubmit=await page\.evaluate\(\(\) => \{[\s\S]*?Array\.from\(document\.querySelectorAll/,
  'the actual worker must inspect registration controls')
assert.match(vaultWorker,/const rect=el\.getBoundingClientRect\(\),style=getComputedStyle\(el\)/,
  'the signup-submit detector must ignore hidden signup forms rather than inspecting all buttons')

assert.match(vaultWorker,/if\(await isActiveRegistrationPage\(page\)\)\{await refuseRegistration\(\);return;\}[\s\S]*?const USER_FIELDS=/,
  'registration refusal must happen before username fields can be filled')
assert.match(vaultWorker,/if\(await isActiveRegistrationPage\(page\)\)\{await refuseRegistration\(\);return;\}[\s\S]*?const submit=await firstVisible/,
  'a redirected registration form must be refused before its submit control is clicked')
assert.match(source,/if \(isBrowserLoginShell\(page\) \|\| detectHumanAuthGate\(page\)\.required \|\| detectProviderAccessBlock\(page\)/,
  'public Obscura observer must fall back instead of completing on login shell')
// Execute the actual Vault worker against inert Playwright mocks, never a
// live browser, provider, account or credential.
const tick=String.fromCharCode(96)
const workerMarker='const VAULT_LOGIN_SCRIPT=String.raw'+tick
const scriptStart=source.indexOf(workerMarker)+workerMarker.length
const scriptEnd=source.indexOf('\n'+tick,scriptStart)
assert.ok(scriptStart>40&&scriptEnd>scriptStart,'actual Vault script must be extractable')
const script=source.slice(scriptStart,scriptEnd)
// Execute the actual in-sandbox model against a display:contents form. Its
// visible email field must be retained even when the form itself has no box.
const modelStart=script.indexOf('async function model(page){')
const modelEnd=script.indexOf('\n\n(async()=>{',modelStart)
assert.ok(modelStart>=0&&modelEnd>modelStart,'actual browser page model must be extractable')
const observedModel=vm.runInNewContext(script.slice(modelStart,modelEnd)+'\nmodel',{URL})
const zeroBoxForm:any={
  action:'https://example.com/auth',method:'post',
  getBoundingClientRect:()=>({width:0,height:0}),
  querySelectorAll:()=>[],
}
const visibleEmail:any={
  id:'signupEmail',tagName:'INPUT',form:zeroBoxForm,
  getAttribute:(key:string)=>key==='name'?'email':key==='type'?'email':null,
  getBoundingClientRect:()=>({width:190,height:32}),
}
zeroBoxForm.querySelectorAll=()=>[visibleEmail]
const observedZeroBox=await observedModel({
  evaluate:async(callback:unknown)=>vm.runInNewContext('('+String(callback)+')()',{
    URL,CSS:{escape:(x:string)=>x},
    location:{href:'https://example.com/auth'},
    document:{
      title:'Welcome',
      body:{innerText:'Home Help Create account Email Continue Already have an account? Log in'},
      forms:[zeroBoxForm],
      querySelectorAll:()=>[visibleEmail],
      querySelector:()=>null,
    },
    getComputedStyle:()=>({visibility:'visible',display:'contents'}),
  }),
})
assert.equal(observedZeroBox.forms.length,1,
  'display:contents form must not disappear when its account field is visible')
assert.equal(observedZeroBox.forms[0].inputs[0].name,'email',
  'actual model must preserve visible email fields inside zero-box form')
assert.equal(isBrowserRegistrationBarrier(observedZeroBox),true,
  'zero-box email-first signup must block backend Vault resolution')

// Execute the same actual worker DOM model with no native <form> element.
// JavaScript-auth panels commonly place an unbound email field and Sign up
// button in a div; synthesized body evidence must keep this active CTA.
const formlessBody:any={innerText:'Home Products Sign up Email Log in'}
const formlessEmail:any={
  id:'newEmail',tagName:'INPUT',form:null,
  getAttribute:(key:string)=>key==='name'?'email':key==='type'?'email':null,
  getBoundingClientRect:()=>({width:180,height:30}),
}
const formlessButton:any={
  tagName:'BUTTON',form:null,innerText:'Sign up',textContent:'Sign up',
  getAttribute:(key:string)=>key==='type'?'button':null,
  closest:()=>null,getBoundingClientRect:()=>({width:95,height:26}),
}
formlessBody.querySelectorAll=()=>[formlessEmail]
const observedFormless=await observedModel({
  evaluate:async(callback:unknown)=>vm.runInNewContext('('+String(callback)+')()',{
    URL,CSS:{escape:(x:string)=>x},
    location:{href:'https://example.com/auth'},
    document:{
      title:'Welcome',body:formlessBody,forms:[],
      querySelectorAll:(selector:string)=>selector.includes('button')?[formlessButton]:[formlessEmail],
      querySelector:()=>null,
    },
    getComputedStyle:()=>({visibility:'visible',display:'block'}),
  }),
})
assert.equal(observedFormless.forms.length,1,'unbound email field creates one synthetic body form')
assert.equal(observedFormless.forms[0].synthetic,true,'synthetic form evidence is explicitly identified')
assert.equal(observedFormless.forms[0].submitLabels[0],'Sign up',
  'visible JS signup button must survive actual worker model')
assert.equal(isBrowserRegistrationBarrier(observedFormless),true,
  'form-less JS signup must block backend Vault before lookup')

// A type=button Sign up mode switch sharing an actual Log in form is not a submit.
const loginForm:any={
  action:'https://example.com/login',method:'post',innerText:'Log in Sign up',
  getBoundingClientRect:()=>({width:250,height:170}),
}
const loginEmail:any={
  id:'loginEmail',tagName:'INPUT',form:loginForm,
  getAttribute:(key:string)=>key==='name'?'email':key==='type'?'email':null,
  getBoundingClientRect:()=>({width:190,height:28}),
}
const loginPassword:any={
  id:'loginPassword',tagName:'INPUT',form:loginForm,
  getAttribute:(key:string)=>key==='name'?'password':key==='type'?'password':null,
  getBoundingClientRect:()=>({width:190,height:28}),
}
loginForm.querySelectorAll=()=>[loginEmail,loginPassword]
const submitButton=(label:string,type:string)=>({
  tagName:'BUTTON',form:loginForm,innerText:label,textContent:label,
  getAttribute:(key:string)=>key==='type'?type:null,
  getBoundingClientRect:()=>({width:90,height:25}),closest:()=>loginForm,
})
const actualLoginSubmit=submitButton('Log in','submit'),loginModeSwitch=submitButton('Sign up','button')
const observedLoginSwitch=await observedModel({
  evaluate:async(callback:unknown)=>vm.runInNewContext('('+String(callback)+')()',{
    URL,CSS:{escape:(x:string)=>x},location:{href:'https://example.com/login'},
    document:{
      title:'Sign in',body:{innerText:'Sign in to your account. Sign up'},
      forms:[loginForm],
      querySelectorAll:(selector:string)=>selector.includes('button')?[actualLoginSubmit,loginModeSwitch]:[loginEmail,loginPassword],
      querySelector:()=>null,
    },getComputedStyle:()=>({visibility:'visible',display:'block'}),
  }),
})
assert.equal(observedLoginSwitch.forms[0].submitLabels.join(','),'Log in',
  'non-submitting Sign up mode switch must be omitted from account-submit labels')
assert.equal(isBrowserRegistrationBarrier(observedLoginSwitch),false,
  'valid existing-login form must not be blocked by a type=button mode switch')

async function syntheticVaultWorker(snapshot:{url:string;title:string;text:string;forms?:any[];signupSubmitVisible?:boolean;signupButtonLabel?:string;signupSubmitInForm?:boolean;signupSubmitType?:string;redirectAfterSubmit?:{url:string;title:string;text:string;forms?:any[]}}){
  const actions:string[]=[]
  const output:string[]=[]
  const field=(kind:string)=>({isVisible:async()=>true,fill:async()=>{actions.push('fill:'+kind)}})
  let current:{url:string;title:string;text:string;forms?:any[];signupSubmitVisible?:boolean;signupButtonLabel?:string;signupSubmitInForm?:boolean;signupSubmitType?:string}=snapshot
  const submit={isVisible:async()=>true,click:async()=>{
    actions.push('click:submit')
    if(snapshot.redirectAfterSubmit)current=snapshot.redirectAfterSubmit
  }}
  const page={
    goto:async()=>{},waitForTimeout:async()=>{},
    locator:(selector:string)=>{
      const user=selector.includes('input[autocomplete')
      const pass=selector==='input[type="password"]'
      const count=user||pass?1:0
      return {count:async()=>count,nth:()=>field(user?'user':'password'),first:()=>submit}
    },
    getByText:()=>({first:()=>submit}),
    evaluate:async(fn:unknown)=>{
      const body=String(fn)
      if(body.includes('const buttons=Array.from')){
        // Run the actual visibility filter against an inert signup button.
        const button={
          textContent:current.signupButtonLabel||'Sign up',value:'',getAttribute:()=>'',closest:(selector:string)=>selector==='form'&&current.signupSubmitInForm!==false?{}:null,
          getBoundingClientRect:()=>({width:current.signupSubmitVisible?80:0,height:current.signupSubmitVisible?25:0}),
        }
        return vm.runInNewContext('('+body+')()',{
          document:{querySelectorAll:()=>[button]},
          getComputedStyle:()=>({display:'block',visibility:'visible'}),
        })
      }
      const observedForms=(current.forms||[]).map((f,i)=>{
        const observedSubmit=i===0&&current.signupSubmitVisible===true&&current.signupSubmitInForm!==false&&current.signupSubmitType!=='button'
        return {...f,submitLabels:[...(f.submitLabels||[]),...(observedSubmit?[current.signupButtonLabel||'Sign up']:[])]}
      })
      return {...current,forms:observedForms}
    },
  }
  const context={pages:()=>[page],close:async()=>{}}
  await vm.runInNewContext(script,{
    require:(name:string)=>{
      assert.equal(name,'playwright')
      return {chromium:{launchPersistentContext:async()=>context}}
    },
    process:{env:{GOGO_LOGIN_URL:snapshot.url,GOGO_VAULT_USERNAME:'fixture-user',GOGO_VAULT_SECRET:'fixture-password'},exit:()=>{throw Error('unexpected script exit')}},
    console:{log:(line:string)=>output.push(line),error:(line:string)=>{throw Error(line)}},
    URL,
  })
  assert.ok(output.every(line=>!line.includes('fixture-user')&&!line.includes('fixture-password')),
    'credential values must not be reported')
  return {actions,vaultLogin:JSON.parse(output.at(-1)!).vaultLogin}
}
const zeroBoxWorker=await syntheticVaultWorker(observedZeroBox)
assert.equal(zeroBoxWorker.vaultLogin.registrationRefused,true,
  'actual worker must reject a zero-box registration form after the model preserves its email')
assert.deepEqual(zeroBoxWorker.actions,[],
  'zero-box registration must not fill or submit any saved credential')
const formlessWorker=await syntheticVaultWorker({
  ...observedFormless,
  signupSubmitVisible:true,signupSubmitInForm:false,signupSubmitType:'button',signupButtonLabel:'Sign up',
})
assert.equal(formlessWorker.vaultLogin.registrationRefused,true,
  'actual worker must refuse a formless JS signup even when its button lacks a form owner')
assert.deepEqual(formlessWorker.actions,[],
  'formless registration cannot autofill or submit saved Vault credentials')
for(const path of ['/session','/guides/auth']){
  const snapshot={...observedFormless,url:'https://example.com'+path,
    forms:observedFormless.forms.map((form:any)=>({...form,action:'https://example.com'+path}))}
  assert.equal(isBrowserRegistrationBarrier(snapshot),true,
    'active formless signup must block backend Vault lookup on '+path)
  const worker=await syntheticVaultWorker({...snapshot,
    signupSubmitVisible:true,signupSubmitInForm:false,signupSubmitType:'button',signupButtonLabel:'Sign up'})
  assert.equal(worker.vaultLogin.registrationRefused,true,
    'worker must refuse active formless signup on '+path)
  assert.deepEqual(worker.actions,[],
    'saved credentials must never be entered into active formless signup on '+path)
}
const modeSwitchWorker=await syntheticVaultWorker({
  ...observedLoginSwitch,
  signupSubmitVisible:true,signupSubmitInForm:true,signupSubmitType:'button',signupButtonLabel:'Sign up',
})
assert.equal(modeSwitchWorker.vaultLogin.registrationRefused,undefined,
  'actual worker must preserve login when Sign up is a type=button mode switch')
assert.deepEqual(modeSwitchWorker.actions.slice(0,2),['fill:user','fill:password'],
  'existing-account login fields remain accessible next to a mode-switch button')

// A header's unbound navigation button is not the submit of a JS login panel.
const headerSignup={...formlessButton,closest:(selector:string)=>selector.includes('header')?{querySelectorAll:()=>[]}:null}
const unboundLoginButton={...formlessButton,innerText:'Log in',textContent:'Log in'}
const unboundPassword={...formlessEmail,id:'existingPassword',getAttribute:(key:string)=>key==='name'?'password':key==='type'?'password':null}
const unboundLoginBody={innerText:'Home Sign in Email Password Log in Sign up',querySelectorAll:()=>[formlessEmail,unboundPassword]}
const observedUnboundLogin=await observedModel({
  evaluate:async(callback:unknown)=>vm.runInNewContext('('+String(callback)+')()',{
    URL,CSS:{escape:(x:string)=>x},location:{href:'https://example.com/session'},
    document:{title:'Welcome',body:unboundLoginBody,forms:[],querySelector:()=>null,
      querySelectorAll:(selector:string)=>selector.includes('button')?[headerSignup,unboundLoginButton]:[formlessEmail,unboundPassword]},
    getComputedStyle:()=>({display:'block',visibility:'visible'}),
  }),
})
assert.deepEqual(Array.from(observedUnboundLogin.forms[0].submitLabels),['Log in'],
  'header navigation must not become an unbound login submit')
assert.equal(isBrowserRegistrationBarrier(observedUnboundLogin),false,
  'JS login with separate header signup stays usable')
const unboundLoginWorker=await syntheticVaultWorker(observedUnboundLogin)
assert.equal(unboundLoginWorker.vaultLogin.registrationRefused,undefined)
assert.deepEqual(unboundLoginWorker.actions.slice(0,2),['fill:user','fill:password'])
for(const snapshot of [
  {url:'https://example.com/register',title:'Register',text:'Create your account'},
  {url:'https://example.com/auth',title:'Create account',text:'Welcome',forms:[{inputs:[{name:'email',type:'email'}]}]},
  {url:'https://example.com/login',title:'Sign in',text:'Log in',forms:[{action:'https://example.com/register',inputs:[{name:'password',type:'password'}]}]},
]){
  const run=await syntheticVaultWorker(snapshot)
  assert.deepEqual(run.actions,[],'registration must not fill or submit any credential')
  assert.equal(run.vaultLogin.registrationRefused,true,'worker must report an inert registration handoff')
  assert.equal(run.vaultLogin.submitted,false,'account creation was not submitted')
}
const existingLogin=await syntheticVaultWorker({
  url:'https://example.com/login',title:'Sign in',text:'Log in. New here? Sign up.',
  forms:[{action:'https://example.com/login',inputs:[{name:'email',type:'email'},{name:'password',type:'password'}]}],
})
assert.equal(existingLogin.vaultLogin.registrationRefused,undefined,'ordinary login should not be misclassified')
assert.deepEqual(existingLogin.actions.slice(0,2),['fill:user','fill:password'],
  'existing-account login retains its normal field path')
const loginWithHiddenSignup=await syntheticVaultWorker({
  url:'https://example.com/login',title:'Sign in',text:'Log in. New here? Sign up.',
  forms:[{action:'https://example.com/login',inputs:[{name:'email',type:'email'},{name:'password',type:'password'}]}],
  signupSubmitVisible:false,
})
assert.equal(loginWithHiddenSignup.vaultLogin.registrationRefused,undefined,
  'hidden signup submit in inactive modal must not block existing-account login')
assert.deepEqual(loginWithHiddenSignup.actions.slice(0,2),['fill:user','fill:password'],
  'visible login form still accepts saved login when inactive signup controls exist')
const loginWithVisibleSignup=await syntheticVaultWorker({
  url:'https://example.com/login',title:'Sign in',text:'Log in. New here? Sign up.',
  forms:[{action:'https://example.com/login',inputs:[{name:'email',type:'email'},{name:'password',type:'password'}]}],
  signupSubmitVisible:true,signupSubmitInForm:true,
})
assert.equal(loginWithVisibleSignup.vaultLogin.registrationRefused,true,
  'a visible signup submit is active registration and must stop Vault')
assert.deepEqual(loginWithVisibleSignup.actions,[],
  'an active visible registration submit cannot receive saved credentials')
const implicitSignup=await syntheticVaultWorker({
  url:'https://example.com/auth',title:'Welcome',
  text:'Home Help Create account. Already have an account? Log in.',
  forms:[{action:'https://example.com/auth',inputs:[{name:'email',type:'email'}]}],
  signupSubmitVisible:true,signupSubmitInForm:false,signupButtonLabel:'Continue — Create account',
})
assert.equal(implicitSignup.vaultLogin.registrationRefused,true,
  'implicit submit on an email-first registration must stop the worker before autofill')
assert.deepEqual(implicitSignup.actions,[],
  'implicit Create account button must not receive or submit saved Vault identity')
const helpHostedSignup=await syntheticVaultWorker({
  url:'https://example.com/help/auth',title:'Welcome',
  text:'Home Help Create account Email Continue. Already have an account? Log in',
  forms:[{action:'https://example.com/help/auth',inputs:[{name:'email',type:'email'}]}],
  signupSubmitVisible:false,signupButtonLabel:'Continue',
})
assert.equal(helpHostedSignup.vaultLogin.registrationRefused,true,
  'help-hosted email-first signup is active registration despite path exemption')
assert.deepEqual(helpHostedSignup.actions,[],
  'help-hosted signup must stop before saved credential autofill')
const plainSignupSubmit=await syntheticVaultWorker({
  url:'https://example.com/auth',title:'Welcome',
  text:'Home Products Log in',
  forms:[{action:'https://example.com/auth',inputs:[{name:'email',type:'email'}]}],
  signupSubmitVisible:true,signupSubmitInForm:true,signupButtonLabel:'Sign up',
})
assert.equal(plainSignupSubmit.vaultLogin.registrationRefused,true,
  'visible form-associated Sign up submit must refuse before passwordless autofill')
assert.deepEqual(plainSignupSubmit.actions,[],
  'form-associated signup must not fill saved identity')
const helpHostedPlainSignup=await syntheticVaultWorker({
  url:'https://example.com/help/auth',title:'Welcome',
  text:'Home Help Sign up Log in',
  forms:[{action:'https://example.com/help/auth',inputs:[{name:'email',type:'email'}],submitLabels:['Sign up'],formText:'Sign up Email'}],
  signupSubmitVisible:true,signupSubmitInForm:true,signupButtonLabel:'Sign up',
})
assert.equal(helpHostedPlainSignup.vaultLogin.registrationRefused,true,
  'help-hosted form-associated Sign up must stop Vault with no Already account cue')
assert.deepEqual(helpHostedPlainSignup.actions,[],
  'help-hosted account Sign up cannot receive Vault identity')
const newsletterGuideAfterLogin=await syntheticVaultWorker({
  url:'https://example.com/guides/signup',title:'Public registration guide',
  text:'Sign up to see photos and videos from friends. This guide is public.',
  forms:[{action:'https://example.com/guides/signup',inputs:[{name:'newsletterEmail',type:'email'}],submitLabels:['Sign up'],formText:'Sign up for newsletter'}],
  signupSubmitVisible:true,signupSubmitInForm:true,signupButtonLabel:'Sign up',
})
assert.equal(newsletterGuideAfterLogin.vaultLogin.registrationRefused,undefined,
  'a public article newsletter signup must not masquerade as account registration after a login redirect')
const signupWithNewsletterOptIn=await syntheticVaultWorker({
  url:'https://example.com/auth',title:'Welcome',
  text:'Create account Email Subscribe to newsletter',
  forms:[{action:'https://example.com/auth',inputs:[{name:'email',type:'email'}],
    submitLabels:['Sign up'],formText:'Create account Email Subscribe to newsletter'}],
  signupSubmitVisible:true,signupSubmitInForm:true,signupButtonLabel:'Sign up',
})
assert.equal(signupWithNewsletterOptIn.vaultLogin.registrationRefused,true,
  'real account signup is not mistaken for newsletter when it offers optional updates')
assert.deepEqual(signupWithNewsletterOptIn.actions,[],
  'real signup plus newsletter preference must never receive saved credentials')
const signupOnlyWithOptionalNewsletter=await syntheticVaultWorker({
  url:'https://example.com/auth',title:'Welcome',
  text:'Home Sign up Email Log in',
  forms:[{action:'https://example.com/auth',inputs:[{name:'email',type:'email'},{name:'newsletter',type:'checkbox'}],
    submitLabels:['Sign up'],formText:'Sign up Email Subscribe to newsletter'}],
  signupSubmitVisible:true,signupSubmitInForm:true,signupButtonLabel:'Sign up',
})
assert.equal(signupOnlyWithOptionalNewsletter.vaultLogin.registrationRefused,true,
  'optional newsletter checkbox must not exempt email-first account signup from Vault refusal')
assert.deepEqual(signupOnlyWithOptionalNewsletter.actions,[],
  'signup with optional newsletter opt-in must never fill saved identity')
const signupOnGuidesRoute=await syntheticVaultWorker({
  url:'https://example.com/guides/auth',title:'Welcome',
  text:'Home Sign up Email Log in',
  forms:[{action:'https://example.com/guides/auth',inputs:[{name:'email',type:'email'}],
    submitLabels:['Sign up'],formText:'Sign up Email'}],
  signupSubmitVisible:true,signupSubmitInForm:true,signupButtonLabel:'Sign up',
})
assert.equal(signupOnGuidesRoute.vaultLogin.registrationRefused,true,
  'guide route alone must not exempt an active account registration')
assert.deepEqual(signupOnGuidesRoute.actions,[],
  'account signup beneath guide URL may not autofill or submit credentials')
const loginWithUnrelatedNewsletter=await syntheticVaultWorker({
  url:'https://example.com/login',title:'Sign in',
  text:'Sign in. Sign up for newsletter updates.',
  forms:[
    {action:'https://example.com/login',inputs:[{name:'email',type:'email'},{name:'password',type:'password'}],
      submitLabels:['Log in'],formText:'Log in'},
    {action:'https://example.com/subscribe',inputs:[{name:'newsletterAddress',type:'email'}],
      submitLabels:['Sign up'],formText:'Newsletter Sign up'}],
  signupSubmitVisible:false,
})
assert.equal(loginWithUnrelatedNewsletter.vaultLogin.registrationRefused,undefined,
  'separate newsletter footer does not block valid account login')
assert.deepEqual(loginWithUnrelatedNewsletter.actions.slice(0,2),['fill:user','fill:password'],
  'saved login stays usable with independent newsletter footer')
const signupWithGenericContinue=await syntheticVaultWorker({
  url:'https://example.com/auth',title:'Welcome',
  text:'Home Help Create account Email Continue Already have an account? Log in',
  forms:[{action:'https://example.com/auth',inputs:[{name:'email',type:'email'}]}],
  signupSubmitVisible:false,signupButtonLabel:'Continue',
})
assert.equal(signupWithGenericContinue.vaultLogin.registrationRefused,true,
  'a generic Continue on a page with active account creation heading is not login')
assert.deepEqual(signupWithGenericContinue.actions,[],
  'generic Continue signup must be refused before filling saved Vault identity')
const loginRedirectToSignup=await syntheticVaultWorker({
  url:'https://example.com/login',title:'Sign in',text:'Log in',
  forms:[{action:'https://example.com/login',inputs:[{name:'email',type:'email'},{name:'password',type:'password'}]}],
  redirectAfterSubmit:{url:'https://example.com/register',title:'Create account',text:'Sign up to proceed',forms:[]},
})
assert.equal(loginRedirectToSignup.vaultLogin.registrationRefused,true,
  'registration after login submit must be refused, never treated as a verified login')
assert.equal(loginRedirectToSignup.vaultLogin.submitted,true,
  'test must exercise a real login submission before the registration redirect')
assert.deepEqual(loginRedirectToSignup.actions.slice(0,2),['fill:user','fill:password'],
  'login credentials are entered only on the originally observed actual login page')

// Exercise the real assessor, not only helper calls or string matching. All pages are synthetic;
// these exits must occur before the model or any provider can be contacted.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic-role'
process.env.OPENAI_API_KEY ||= 'synthetic-api'
process.env.ANTHROPIC_API_KEY ||= 'synthetic-api'
const {assessReadOutcome}=await import('../lib/agent/secure-computer')
for(const page of [instagramLogin, combinedInstagramGate, combinedGenericGate, accountCreationShell,
  signupOnlyInstagramShell, signupRouteShell, genericSignupForm,
  {url:'https://www.instagram.com/p/example',title:'Instagram',text:'Instagram Log in Sign up About Help Press Privacy Terms'},
  {url:'https://example.com/login',title:'Sign in',text:'Username Password'},
]){
  const reasons:string[]=[]
  const result=await assessReadOutcome('Read the actual post content and author, not the login screen',page,d=>reasons.push(d.reason))
  assert.equal(result,null,'a login shell must never produce a successful excerpt')
  assert.deepEqual(reasons,['source_unusable'],'the assessor must block BEFORE asking a model')
}
console.log('PASS: login destinations, Instagram footer-only views and explicit auth gates cannot be marked completed; public sign-in navigation remains readable')
