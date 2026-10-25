import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const feature=readFileSync(new URL('../lib/feature-intents.ts',import.meta.url),'utf8')
const autonomy=readFileSync(new URL('../lib/agent/adaptive-autonomy.ts',import.meta.url),'utf8')

const autonomyPos=feature.indexOf('const autonomy=parseAutonomyCommand(text)')
const reminderPos=feature.indexOf('normalizeNaturalReminderSave(text)')
const legacyPos=feature.indexOf('routeLegacyFeatureIntent(phone, text, extra)')
assert.ok(autonomyPos>=0&&reminderPos>=0&&legacyPos>=0)
assert.ok(autonomyPos<reminderPos,'autonomy control must run before reminder mutation routing')
assert.ok(autonomyPos<legacyPos,'autonomy control must run before legacy capability routing')

assert.match(feature,/capabilityIsOff\(extra\.telegramId,'reminders'\)/)
assert.match(feature,/capabilityIsOff\(extra\.telegramId,'lists'\)/)
assert.match(autonomy,/export async function capabilityPermissionLevel/)
assert.match(autonomy,/export async function capabilityIsOff/)

console.log('adaptive autonomy routing and off-gate coverage passed')
