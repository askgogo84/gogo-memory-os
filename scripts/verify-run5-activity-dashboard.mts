import assert from 'node:assert/strict'
import fs from 'node:fs'

const activity=fs.readFileSync('app/dashboard/(app)/activity/page.tsx','utf8')
const detail=fs.readFileSync('app/dashboard/(app)/activity/[runId]/page.tsx','utf8')
const browser=fs.readFileSync('app/dashboard/(app)/activity/[runId]/browser/page.tsx','utf8')
const handoff=fs.readFileSync('app/api/dashboard/agent/runs/[runId]/handoff/route.ts','utf8')
const shot=fs.readFileSync('app/api/dashboard/agent/runs/[runId]/browser-shot/route.ts','utf8')
const side=fs.readFileSync('components/dashboard/side-rail.tsx','utf8')
const tabs=fs.readFileSync('components/dashboard/tab-bar.tsx','utf8')

assert.match(activity,/What Gogo has done, newest first/)
assert.match(activity,/Reminders.*Browser.*Research.*Documents/s)
assert.match(detail,/Open browser view/)
assert.match(browser,/Blocked by the provider/)
assert.match(browser,/Take control/)
assert.doesNotMatch(browser,/<input[^>]*(?:otp|one-time|code|password|payment)/i,'Activity browser must not collect authentication secrets')

for(const source of [handoff,shot]){
  assert.match(source,/getSession\(\)/)
  assert.match(source,/telegram_id/)
  assert.match(source,/runId/)
}
assert.match(handoff,/handoff\.providerUrl/)
assert.match(handoff,/handoff\.takeoverUrl/)
assert.match(shot,/\/shot/)
assert.match(side,/\/dashboard\/activity/)
assert.match(tabs,/key: 'activity'/)

console.log('Run 5 Activity / Task Detail dashboard contract passed')
