import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { redactBrowserSensitiveText } from '../lib/agent/secure-browser-redaction'

const computer=readFileSync(new URL('../lib/agent/secure-computer.ts',import.meta.url),'utf8')
const ticket=readFileSync(new URL('../lib/agent/secure-ticket-reader.ts',import.meta.url),'utf8')
const bootstrap=readFileSync(new URL('../lib/agent/secure-browser-bootstrap.ts',import.meta.url),'utf8')
const browser=readFileSync(new URL('../lib/agent/browser-command.ts',import.meta.url),'utf8')
const runRoute=readFileSync(new URL('../app/api/agent/run/route.ts',import.meta.url),'utf8')
const execRoute=readFileSync(new URL('../app/api/agent/runs/[id]/execute/route.ts',import.meta.url),'utf8')

// Secure Computer is an isolated Vercel Sandbox, keyed by a one-way user hash.
assert.match(computer,/Sandbox\.getOrCreate/)
assert.match(computer,/createHash\('sha256'\)/)
assert.match(computer,/gogo-browser-/)
assert.match(computer,/persistent:true/)

// India launch defaults each per-user secure browser microVM to Mumbai while
// keeping an explicit environment override for later regional expansion.
assert.match(computer,/GOGO_SANDBOX_REGION/)
assert.match(computer,/\|\| 'bom1'/)
assert.match(computer,/region:SANDBOX_REGION/)

// Setup egress is explicit, then policy is replaced with the requested target
// family before user browser work runs.
assert.match(computer,/networkPolicy:BROWSER_SETUP_NETWORK/)
assert.match(computer,/updateNetworkPolicy\(\{allow\}/)

// Both browser surfaces share the ONE proven bootstrap and never drift.
assert.match(computer,/ensureBrowserRuntime\(sandbox\)/)
assert.match(ticket,/ensureBrowserRuntime\(sandbox\)/)
assert.match(ticket,/networkPolicy: BROWSER_SETUP_NETWORK/)

// --- Vercel Sandbox bootstrap invariants ---
assert.match(bootstrap,/vercel\/sandbox\/node:24/)
assert.doesNotMatch(computer,/runtime:\s*'node24'/)
assert.doesNotMatch(ticket,/runtime:\s*'node24'/)
assert.match(bootstrap,/\/home\/vercel-sandbox/)
assert.match(bootstrap,/browser-profile/)
assert.doesNotMatch(computer,/\/vercel\/sandbox/)
assert.doesNotMatch(ticket,/\/vercel\/sandbox/)
assert.match(bootstrap,/npx playwright install chromium/)
assert.doesNotMatch(bootstrap,/install --with-deps/)
assert.match(bootstrap,/sudo:\s*true/)
assert.match(bootstrap,/command -v apt-get/)
assert.match(bootstrap,/npx playwright install-deps chromium/)
assert.match(bootstrap,/command -v dnf/)
assert.match(bootstrap,/dnf install -y --skip-broken/)
assert.match(bootstrap,/command -v yum/)
assert.match(bootstrap,/https:\/\/archive\.ubuntu\.com/)
assert.match(bootstrap,/apt-get update/)
assert.match(bootstrap,/registry\.npmjs\.org/)
assert.match(bootstrap,/cdn\.playwright\.dev/)
assert.match(bootstrap,/storage\.googleapis\.com/)
assert.match(bootstrap,/archive\.ubuntu\.com/)
assert.match(bootstrap,/security\.ubuntu\.com/)
assert.match(bootstrap,/cdn\.amazonlinux\.com/)
assert.match(bootstrap,/amazonaws\.com/)
assert.match(bootstrap,/playwright@\$\{PLAYWRIGHT_VERSION\}/)
assert.match(bootstrap,/PLAYWRIGHT_VERSION = '1\.63\.0'/)
assert.match(bootstrap,/chromium\.launch\(\{headless:true\}\)/)
assert.match(bootstrap,/chromium_launch_probe_failed/)
assert.match(bootstrap,/updateNetworkPolicy\(BROWSER_SETUP_NETWORK/)

// Real Chromium/Playwright is installed inside the microVM, not in the Next.js
// function process. Browser code is a fixed script; the LLM only proposes a small
// allowlisted action JSON sequence.
assert.match(computer,/MAX_ACTIONS = 12/)
assert.match(computer,/Allowed action kinds: goto, click, fill, select, check, wait, submit/)
assert.doesNotMatch(computer,/\beval\s*\(/)

// Draft mode physically skips submit controls, and the action planner is told not
// to invent credentials/secrets.
assert.match(computer,/payload\.mode!==['"]execute['"]/)
assert.match(computer,/Never invent passwords, OTPs, card numbers or secret values/)
assert.match(computer,/if\(payload\.mode!==['"]execute['"]\).*status:'skipped'/s)

// External submit/booking/purchase requests are represented as one-shot approvals.
assert.match(browser,/approvalAction\?:'submit_form'\|'booking'\|'purchase'/)
assert.match(browser,/agent_approvals/)
assert.match(browser,/evaluateAgentExecutionPolicy/)
assert.match(browser,/eq\('status','approved'\)/)
assert.match(browser,/executeApprovedBrowserCommand/)

// Full page text and filled values are deliberately not persisted to Activity.
assert.match(browser,/text:`\$\{result\.summary\}[\s\S]*safe\(result\.pageText,1800\)/)
assert.match(browser,/activity\(tg,params\.runId,'run_completed',result\.summary,\{host:new URL\(result\.url\)\.hostname,action_count:result\.actions\.length\}\)/)
assert.doesNotMatch(browser,/metadata_json:\{[^}]*pageText/s)
assert.doesNotMatch(browser,/activity\([^\n]*form[sVv]alue/s)

// Signed provider/booking URLs and opaque subprocess payloads must never survive
// the Secure Computer logging/model boundary. Preserve host/path and parameter
// names for diagnostics, but remove every query value, URL fragment and long token.
const signed='Browser failed at https://in.bookmyshow.com/booking/ticket?token=super-secret-abc&signature=deadbeef#receipt'
const redacted=redactBrowserSensitiveText(signed)
assert.match(redacted,/https:\/\/in\.bookmyshow\.com\/booking\/ticket/)
assert.match(redacted,/token=/)
assert.match(redacted,/signature=/)
assert.doesNotMatch(redacted,/super-secret-abc/)
assert.doesNotMatch(redacted,/deadbeef/)
assert.doesNotMatch(redacted,/receipt/)

// Regression for the P1 ordering case: if a query key itself is a generic secret
// label, URL redaction must still consume the whole URL before generic redaction
// can insert whitespace into a marker and strand later signed parameters.
const labelledFirst='https://example.com/callback?password=first-secret&signature=LEAKME&otp=123456#receipt'
const labelledFirstRedacted=redactBrowserSensitiveText(labelledFirst)
assert.match(labelledFirstRedacted,/https:\/\/example\.com\/callback/)
assert.match(labelledFirstRedacted,/password=/)
assert.match(labelledFirstRedacted,/signature=/)
assert.match(labelledFirstRedacted,/otp=/)
assert.doesNotMatch(labelledFirstRedacted,/first-secret/)
assert.doesNotMatch(labelledFirstRedacted,/LEAKME/)
assert.doesNotMatch(labelledFirstRedacted,/123456/)
assert.doesNotMatch(labelledFirstRedacted,/receipt/)

const opaque='eyJ1cmwiOiJodHRwczovL2V4YW1wbGUuY29tLz90b2tlbj1zZWNyZXQiLCJtb2RlIjoiZXhlY3V0ZSJ9'.repeat(2)
assert.equal(redactBrowserSensitiveText(opaque),'[sensitive token withheld]')
assert.match(computer,/redactBrowserSensitiveText/)
assert.match(computer,/SECURE_BROWSER_FAILED:',safeError/)
assert.doesNotMatch(computer,/SECURE_BROWSER_FAILED:', error\?\.stack/)
assert.match(computer,/links:\(page\.links\|\|\[\]\).*href:safeText/s)
assert.match(computer,/forms:\(page\.forms\|\|\[\]\).*action:safeText/s)

// Both new and approved-run APIs route secure browser plans explicitly.
assert.match(runRoute,/tryRunBrowserCommand/)
assert.match(execRoute,/planType === 'secure_browser'/)
assert.match(execRoute,/executeApprovedBrowserCommand/)

console.log('agent secure browser verification passed')
