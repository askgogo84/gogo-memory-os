// 22 Nov live: "Reply to IndiaFilings Team" showed "company&#39;s" and "You&#39;re" in the open-loop list, because
// older email-derived rows were saved with HTML entities. The list decodes them on display.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const { decodeHtmlEntities } = await import('../lib/agent/google-workspace-read')
const ol: any = await import('../lib/agent/open-loops')
assert.equal(decodeHtmlEntities("filing your company&#39;s annual accounts. You&#39;re not alone &amp; more"), "filing your company's annual accounts. You're not alone & more")
const src = readFileSync(new URL('../lib/agent/open-loops.ts', import.meta.url), 'utf8')
const body = src.slice(src.indexOf('export async function handleOpenLoopQuery'), src.indexOf('export function isOpenLoopActionCandidate'))
assert.match(body, /clean\(decodeHtmlEntities\(String\(loop\.summary\|\|''\)\),260\)/)
assert.match(body, /clean\(decodeHtmlEntities\(String\(loop\.title\|\|''\)\),180\)/)
assert.doesNotMatch(body, /\$\{clean\(loop\.title,180\)\}/, 'the raw title is no longer printed')
console.log('✓ open-loop titles and summaries are shown without HTML entities')
// Review of #1566: decode at the source, so saved rows and the close/snooze replies are clean too.
assert.match(src, /function clean\(value:unknown,max=500\)\{\n  return decodeHtmlEntities\(String\(value\?\?''\)\)/)
console.log('✓ open-loop text is decoded before it is saved and in every reply')
