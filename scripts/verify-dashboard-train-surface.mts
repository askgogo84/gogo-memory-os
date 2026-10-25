import assert from 'node:assert/strict'
import fs from 'node:fs'

const source=fs.readFileSync('app/api/dashboard/chat/route.ts','utf8')

assert.ok(source.includes("import { tryRunTrainResearch } from '@/lib/agent/train-research'"))
const train=source.indexOf("tryRunTrainResearch({ actor, surface:'web', text })")
const general=source.indexOf('tryRunGeneralPlan({')
const feature=source.indexOf('routeFeatureIntent(')
assert.ok(train>=0,'dashboard must call train specialist')
assert.ok(general>train,'train specialist must run before general planner')
assert.ok(feature>train,'train specialist must run before feature/WhatsApp bridge')
assert.ok(source.includes('runId: trainResearch.runId'))
assert.ok(source.includes('status: trainResearch.status'))

console.log('dashboard train surface routing regression passed')
