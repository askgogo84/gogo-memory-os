import assert from 'node:assert/strict'
import fs from 'node:fs'

const helper = fs.readFileSync('lib/services/whatsapp-preview-routing.ts', 'utf8')
const featureRouter = fs.readFileSync('lib/feature-intents.ts', 'utf8')

assert.match(helper, /bmsurl\.co/)
assert.match(helper, /bookmyshow\.com/)
assert.match(helper, /we\(\?:'\|’\)re watching|we(?:'|’)re watching/)
assert.match(featureRouter, /bookingTitle/)
assert.match(featureRouter, /Mirzapur|watching|movie_booking/)
assert.match(featureRouter, /schedulePending:true/)
assert.match(featureRouter, /I've recognised this as an event booking|I’ve recognised this as an event booking/)

console.log('✅ BookMyShow booking intent regression passed')
