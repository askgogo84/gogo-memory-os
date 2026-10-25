import assert from 'node:assert/strict'
import { isWeatherQuery } from '../lib/bot/handlers/deterministic'
import { detectIntent } from '../lib/bot/detect-intent'

// Permanent regression cases. Every past routing hijack gets a line here.
// TWO matchers claim weather. Both must be word-bounded, and both are tested:
//   lib/bot/handlers/deterministic.ts  isWeatherQuery
//   lib/bot/detect-intent.ts           weather_live  <- this is the live path

const notWeather = [
  'Find me direct trains from Bangalore to Mysuru on 20 September 2026',
  'show me trains to Mysuru',
  'irctc train availability',
  'I have training at 6am',
  'drain the cache',
  'book a temporary desk',
  'restrain the scope of this PR',
]
const isWeather = [
  'what is the weather in Bangalore',
  'will it rain tomorrow',
  'temperature in Dubai today',
  'rainfall this week',
]

for (const text of notWeather) {
  assert.equal(isWeatherQuery(text), false, `isWeatherQuery must not claim: ${text}`)
  assert.notEqual(detectIntent(text).type, 'weather_live', `detectIntent must not claim: ${text}`)
}
for (const text of isWeather) {
  assert.equal(isWeatherQuery(text), true, `isWeatherQuery must claim: ${text}`)
  assert.equal(detectIntent(text).type, 'weather_live', `detectIntent must claim: ${text}`)
}

console.log('routing regression (weather vs train, both matchers) verification passed')
