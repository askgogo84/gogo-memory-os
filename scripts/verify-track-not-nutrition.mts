import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 21:29: "Track divya flight.. where is it now?" was answered with "I log meals rather than look up
// calorie counts" because detectIntent sent every message starting with "track " to the meal logger.
// Run: npx tsx scripts/verify-track-not-nutrition.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'
const d: any = await import('../lib/bot/detect-intent')
const type = (t: string) => d.detectIntent(t).type
for (const t of ['Track divya flight.. where is it now?', 'Track Divya flight', 'track my order', 'log in', 'log my weight', 'track the delivery']) {
  assert.notEqual(type(t), 'nutrition_log', `"${t}" is not a meal`)
  assert.notEqual(type(t), 'nutrition_query', `"${t}" is not a meal`)
}
for (const t of ['log 2 rotis and dal', 'track my lunch', 'track this', 'log this', 'log breakfast: poha', 'track 2 idlis', 'had 2 rotis with dal']) {
  assert.equal(type(t), 'nutrition_log', `"${t}" is still a meal log`)
}
assert.equal(type('track KL879'), 'web_search', 'a concrete flight code is not a meal either')

const pulse = readFileSync(new URL('../lib/agent/autonomy-pulse.ts', import.meta.url), 'utf8')
assert.match(pulse, /decodeHtmlEntities\(\[/, 'the proactive pulse decodes HTML entities before sending')
const ws: any = await import('../lib/agent/google-workspace-read')
assert.equal(ws.decodeHtmlEntities("company&#39;s accounts &amp; filing"), "company's accounts & filing")
console.log('"track <non-food>" is not a meal log; proactive pulse never shows raw HTML entities')
