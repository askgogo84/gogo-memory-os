import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const computer=readFileSync(new URL('../lib/agent/secure-computer.ts',import.meta.url),'utf8')
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
assert.match(computer,/networkPolicy:setupPolicy/)
assert.match(computer,/updateNetworkPolicy\(\{allow\}/)
assert.match(computer,/registry\.npmjs\.org/)
assert.match(computer,/cdn\.playwright\.dev/)

// Real Chromium/Playwright is installed inside the microVM, not in the Next.js
// function process. Browser code is a fixed script; the LLM only proposes a small
// allowlisted action JSON sequence.
assert.match(computer,/playwright@\$\{PLAYWRIGHT_VERSION\}/)
assert.match(computer,/playwright install --with-deps chromium/)
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
// The returned pageText is only sent to the requesting surface, while Activity
// records contain host/action-count or bounded error metadata.
assert.match(browser,/text:`\$\{result\.summary\}[\s\S]*safe\(result\.pageText,1800\)/)
assert.match(browser,/activity\(tg,params\.runId,'run_completed',result\.summary,\{host:new URL\(result\.url\)\.hostname,action_count:result\.actions\.length\}\)/)
assert.doesNotMatch(browser,/metadata_json:\{[^}]*pageText/s)
assert.doesNotMatch(browser,/activity\([^\n]*form[sVv]alue/s)

// Both new and approved-run APIs route secure browser plans explicitly.
assert.match(runRoute,/tryRunBrowserCommand/)
assert.match(execRoute,/planType === 'secure_browser'/)
assert.match(execRoute,/executeApprovedBrowserCommand/)

console.log('agent secure browser verification passed')
