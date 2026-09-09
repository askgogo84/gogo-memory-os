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
assert.match(browser,/Never persist full page text or form values in Activity/)
assert.doesNotMatch(browser,/metadata_json:\{[^}]*pageText/s)

// Both new and approved-run APIs route secure browser plans explicitly.
assert.match(runRoute,/tryRunBrowserCommand/)
assert.match(execRoute,/planType === 'secure_browser'/)
assert.match(execRoute,/executeApprovedBrowserCommand/)

console.log('agent secure browser verification passed')
