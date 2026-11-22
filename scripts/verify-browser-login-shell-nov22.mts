// Synthetic-only browser auth evidence gate. Never opens a browser or uses a real account.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {isBrowserLoginShell} from '../lib/agent/browser-evidence'

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
assert.equal(isBrowserLoginShell({
  url:'https://www.instagram.com/p/example', title:'Public brand post',
  text:'Instagram Sign up to see photos and videos from friends. brandname New product launch today. November 22 About Help Press Privacy Terms',
}),false,'real unlabelled caption beneath a signup-only banner remains readable')
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
assert.match(source,/if \(isBrowserLoginShell\(page\) \|\| detectHumanAuthGate\(page\)\.required \|\| detectProviderAccessBlock\(page\)/,
  'public Obscura observer must fall back instead of completing on login shell')
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
