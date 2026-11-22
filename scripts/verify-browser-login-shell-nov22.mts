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
const source=readFileSync(new URL('../lib/agent/secure-computer.ts',import.meta.url),'utf8')
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

assert.match(source,/if\(!params\.publicOnly && !vaultAttempted && params\.accountCreation!==true && !registrationBarrier && !publicGuideRead/,
  'credential lookup must be unreachable from registration and public guide reads')
assert.match(source,/const publicGuideRead=params\.mode==='read'&&!loginish/,
  'public guides/newsletter forms may not trigger a stored Vault login')
const vaultWorker=source.slice(source.indexOf('const VAULT_LOGIN_SCRIPT=String.raw'),source.indexOf("// 16 Oct: the person's sign-in code"))
assert.match(vaultWorker,/const registrationSubmit=await page\.evaluate\(\(\) => Array\.from\(document\.querySelectorAll/,
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
async function syntheticVaultWorker(snapshot:{url:string;title:string;text:string;forms?:any[];signupSubmitVisible?:boolean;signupButtonLabel?:string;signupSubmitInForm?:boolean;redirectAfterSubmit?:{url:string;title:string;text:string;forms?:any[]}}){
  const actions:string[]=[]
  const output:string[]=[]
  const field=(kind:string)=>({isVisible:async()=>true,fill:async()=>{actions.push('fill:'+kind)}})
  let current:{url:string;title:string;text:string;forms?:any[];signupSubmitVisible?:boolean;signupButtonLabel?:string;signupSubmitInForm?:boolean}=snapshot
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
      if(body.includes('button,input[type="submit"],[role="button"]')){
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
      return {...current,forms:current.forms||[]}
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
