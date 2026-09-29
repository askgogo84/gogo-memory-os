import assert from 'node:assert/strict'
import { detectIntent } from '../lib/bot/detect-intent'

// A live flight-status question that names a concrete flight must attempt an actual
// lookup (web_search), not be delegated back to the user ("check FlightAware yourself").
for (const text of [
  'has EY1 landed?',
  'has EY 1 landed yet',
  'what is the status of AI 505',
  'is 6E203 delayed?',
  'track my EY 1 flight',
  'did AI101 land on time?',
]) {
  assert.equal(detectIntent(text).type, 'web_search', `flight-status with an identifier must route to web_search: ${text}`)
}

// A pronoun-only status question (no flight identifier in THIS message) must NOT be sent
// to a blind web search — it stays on the recall path, which refuses to claim a landing
// from the saved schedule alone.
for (const text of [
  'has it landed?',
  'has she landed yet?',
  'did her flight land?',
]) {
  assert.notEqual(detectIntent(text).type, 'web_search', `pronoun-only status must not blind-search: ${text}`)
}

// A flight identifier WITHOUT a status/tracking verb is not a live-status lookup.
for (const text of [
  'add EY1 to my travel list',
  'remind me about AI 505 tomorrow',
]) {
  assert.notEqual(detectIntent(text).type, 'web_search', `non-status mention must not route to web_search: ${text}`)
}

console.log('✅ live flight-status: identifier-bearing status questions attempt a real lookup; pronoun-only stays on recall')
