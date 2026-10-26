// 26 Oct live (WhatsApp 13:26 IST): "Open <croma page> read-only and hand control back to me" ran inside the 42s webhook
// window, timed out, and the orphaned read still held the browser; the background retry then failed with
// browser_handoff_in_use and blamed a days-old paused task (4de75c11). Offline.
// Run: npx --yes tsx scripts/verify-whatsapp-background-read-oct26.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://synthetic.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'synthetic'
process.env.OPENAI_API_KEY ||= 'synthetic'

const bc = await import('../lib/agent/browser-command')
const actor = { userId: 'u', legacyTelegramId: -1, whatsappId: '+910000000000' } as any
// Guard paths return before any database call: these stay on their existing inline routes.
for (const text of [
  'Fill the form at https://example.com/apply with my details',              // draft
  'Book the 7pm slot at https://example.com/venue',                           // execute (approval path)
  'Open https://www.amazon.in/gp/your-account/order-history and check my last order read-only', // saved-login site
  'https://example.com',                                                       // no browser signal
]) assert.equal(await bc.tryQueueWhatsAppPublicRead({ actor, text }), null, text)

const cmd = readFileSync(new URL('../lib/agent/browser-command.ts', import.meta.url), 'utf8')
const fn = cmd.slice(cmd.indexOf('export async function tryQueueWhatsAppPublicRead'), cmd.indexOf('export async function executeApprovedBrowserCommand'))
assert.match(fn, /if\(parseConnectedProviderCartAction\(params\.text\)\)return null/)
assert.match(fn, /if\(!command\|\|command\.mode!=='read'\)return null/, 'only reads are queued')
assert.match(fn, /if\(findVaultProviderForDomain\(host\)\)return null/, 'saved-login sites keep their kept-alive path')
assert.match(fn, /evaluateAgentSentinel\(/, 'the sentinel still screens the request')
assert.match(fn, /findActiveBrowserRead\(/, 'a duplicate message does not start a second read')
assert.match(fn, /queued=await queueBrowserRead\(\{actor:params\.actor,surface:'whatsapp',text:params\.text\}\)/)
assert.match(fn, /Nothing will be bought, booked or submitted\./)

const wa = readFileSync(new URL('../lib/agent/whatsapp-bridge.ts', import.meta.url), 'utf8')
const sites = [...wa.matchAll(/withWhatsAppBrowserBudget\(\s*actor\s*,\s*tryRunBrowserCommand\(/g)]
assert.equal(sites.length, 2, 'two inline browser sites')
for (const m of sites) {
  const before = wa.slice(Math.max(0, m.index! - 260), m.index!)
  assert.match(before, /tryQueueWhatsAppPublicRead\(\{\s*actor\s*,\s*text:\s*params\.text\s*\}\)/, 'each inline site tries the background read first')
}

// The background worker delivers paused (hand-back) and completed text on WhatsApp.
const worker = readFileSync(new URL('../lib/agent/approved-browser-worker.ts', import.meta.url), 'utf8')
assert.match(worker, /result\?\.status === 'completed' \|\| result\?\.status === 'paused' \? String\(result\.text/)

// The in-use reply names only a task whose takeover browser is live.
const notice = readFileSync(new URL('../lib/agent/browser-auth-notice.ts', import.meta.url), 'utf8')
const reply = notice.slice(notice.indexOf('export async function browserHandoffInUseReply'), notice.indexOf('export async function humanAuthTakeoverReply'))
assert.match(reply, /browserHandoffIsLive\(r\.metadata_json\.handoff\.takeoverUrl\)/)
assert.match(reply, /Gogo's browser is still busy with an earlier request\. Try again in a minute/)
assert.match(reply, /Promise\.all\(rows\.map/, 'liveness probes run in parallel (webhook budget)')
assert.match(reply, /waiting\.metadata_json\?\.handback/, 'a handed-back page gets its own wording, not "sign in"')
assert.doesNotMatch(reply.slice(reply.lastIndexOf('}catch')), /Another browser task is waiting/, 'a failed lookup never blames a task')
// Review round 2: a queued read is found by a resent message; a failed queue never falls back to a second inline run.
const active = cmd.slice(cmd.indexOf('async function findActiveBrowserRead'), cmd.indexOf('export async function runBrowserCommand'))
assert.match(active, /error\.in\.\(background_read_queued,background_read_running,whatsapp_browser_response_timeout\)/)
assert.match(active, /error\.like\.background_resume_claimed\*/)
assert.match(fn, /I couldn't start opening \$\{host/, 'queue failure is reported, not retried inline')
assert.match(fn, /rememberTypedObjects\(params\.actor\.legacyTelegramId,'browser'/)
assert.match(cmd, /if\(queueError\)throw new Error\('background_read_queue_save_failed'\)/)
console.log('WhatsApp public page reads run in the background; the in-use reply never blames a stale task')
