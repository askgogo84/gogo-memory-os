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
  url:'https://example.com/articles/authentication',title:'A guide to passkeys',
  text:'Our article discusses why many sites use a Sign in link, but this is public article text.',
}),false,'incidental authentication references must not trigger a handoff')

// Assert that the actual browser entry points use this pure gate, not just the test fixture.
const source=readFileSync(new URL('../lib/agent/secure-computer.ts',import.meta.url),'utf8')
const assessor=source.slice(source.indexOf('export async function assessReadOutcome('))
assert.match(assessor.slice(0,650),/if\(isBrowserLoginShell\(page\)\|\|detectHumanAuthGate\(page\)\.required\)/,
  'read assessor must reject login shells before model or title-only completion')
assert.match(source,/function pageLooksLikeLogin\(page:any\)\{\s*return isBrowserLoginShell\(page\)/,
  'the same-run auth handoff must recognize signed-out shells')
assert.match(source,/if \(isBrowserLoginShell\(page\) \|\| detectHumanAuthGate\(page\)\.required \|\| detectProviderAccessBlock\(page\)/,
  'public Obscura observer must fall back instead of completing on login shell')
console.log('PASS: login destinations, Instagram footer-only views and explicit auth gates cannot be marked completed; public sign-in navigation remains readable')
