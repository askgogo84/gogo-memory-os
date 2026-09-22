import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const worker=readFileSync('app/api/cron/autonomous-runs/route.ts','utf8')
const browser=readFileSync('lib/agent/browser-command.ts','utf8')

assert.match(worker,/resumePausedBrowserRun/)
assert.match(worker,/whatsapp_browser_response_timeout/)
assert.match(worker,/mode==='execute'/)
assert.match(worker,/background_resume_claimed:/)
assert.match(worker,/Background Gogo finished the browser task/)
assert.match(browser,/export async function resumePausedBrowserRun/)
assert.match(browser,/if\(mode==='execute'\)/)
assert.match(browser,/approval_required/)

console.log('Background secure-browser resume verification passed')
