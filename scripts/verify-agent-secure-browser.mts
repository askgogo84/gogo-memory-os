import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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
// 1. Supported image form, NOT the deprecated runtime:'node24'.
assert.match(bootstrap,/vercel\/sandbox\/node:24/)
assert.doesNotMatch(computer,/runtime:\s*'node24'/)
assert.doesNotMatch(ticket,/runtime:\s*'node24'/)
// 2. Use the managed image's canonical workspace/profile path.
assert.match(bootstrap,/\/home\/vercel-sandbox/)
assert.match(bootstrap,/browser-profile/)
assert.doesNotMatch(computer,/\/vercel\/sandbox/)
assert.doesNotMatch(ticket,/\/vercel\/sandbox/)
// 3. Chromium binary installed as the sandbox user WITHOUT --with-deps; OS libs
//    installed separately as root with whichever package manager the image has.
assert.match(bootstrap,/npx playwright install chromium/)
assert.doesNotMatch(bootstrap,/install --with-deps/)
assert.match(bootstrap,/sudo:\s*true/)
assert.match(bootstrap,/command -v apt-get/)
assert.match(bootstrap,/npx playwright install-deps chromium/)
assert.match(bootstrap,/command -v dnf/)
assert.match(bootstrap,/dnf install -y --skip-broken/)
assert.match(bootstrap,/command -v yum/)
// 4. apt must go over HTTPS when that path is used.
assert.match(bootstrap,/https:\/\/archive\.ubuntu\.com/)
assert.match(bootstrap,/apt-get update/)
// 5. Setup egress covers npm, Playwright/browser redirects, Ubuntu apt repos,
//    and Amazon Linux package repositories used by dnf-based sandboxes.
assert.match(bootstrap,/registry\.npmjs\.org/)
assert.match(bootstrap,/cdn\.playwright\.dev/)
assert.match(bootstrap,/storage\.googleapis\.com/)
assert.match(bootstrap,/archive\.ubuntu\.com/)
assert.match(bootstrap,/security\.ubuntu\.com/)
assert.match(bootstrap,/cdn\.amazonlinux\.com/)
assert.match(bootstrap,/amazonaws\.com/)
// 6. Pinned Playwright version lives in the shared bootstrap.
assert.match(bootstrap,/playwright@\$\{PLAYWRIGHT_VERSION\}/)
assert.match(bootstrap,/PLAYWRIGHT_VERSION = '1\.63\.0'/)
// 7. Readiness requires a real Chromium launch, not only a binary-on-disk check.
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
