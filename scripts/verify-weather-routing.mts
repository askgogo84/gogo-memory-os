import assert from 'node:assert/strict'
import { isWeatherQuery } from '../lib/bot/handlers/deterministic'

// Permanent regression cases. Every past routing hijack gets a line here.

// 1. THE TRAIN/RAIN HIJACK (Sep 2026): "trains" contains "rain".
assert.equal(isWeatherQuery('Find me direct trains from Bangalore to Mysuru on 20 September 2026'), false, 'train request must not be a weather query')
assert.equal(isWeatherQuery('show me trains to Mysuru'), false)
assert.equal(isWeatherQuery('irctc train availability'), false)

// 2. Other words containing "rain" or "temp".
assert.equal(isWeatherQuery('I have training at 6am'), false)
assert.equal(isWeatherQuery('drain the cache'), false)
assert.equal(isWeatherQuery('book a temporary desk'), false)
assert.equal(isWeatherQuery('restrain the scope of this PR'), false)

// 3. Real weather queries MUST still work.
assert.equal(isWeatherQuery('what is the weather in Bangalore'), true)
assert.equal(isWeatherQuery('will it rain tomorrow'), true)
assert.equal(isWeatherQuery('temperature in Dubai today'), true)
assert.equal(isWeatherQuery('rainfall this week'), true)

console.log('routing regression (weather vs train) verification passed')
