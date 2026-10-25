import assert from 'node:assert/strict'
import { shouldAttemptNaturalAssetRetrieval } from '../lib/services/asset-natural-retrieval'

// Exact production failure: this is an operational appointment command, not a
// request to retrieve a saved document. Asset Memory must decline it entirely.
assert.equal(shouldAttemptNaturalAssetRetrieval("Use option 2, Dr. Nishanth Shetty. Open the provider's actual appointment booking page and check whether any live slots are publicly visible for next week. Do not book, confirm, call, or create anything. If live slots cannot be verified, tell me exactly what blocks access."), false)

// The same guard protects every booking surface sharing the WhatsApp runtime.
assert.equal(shouldAttemptNaturalAssetRetrieval('Open the airline booking page and check live flight fares to Delhi. Do not book, pay, confirm, or create anything.'), false)
assert.equal(shouldAttemptNaturalAssetRetrieval('Open the concert ticket page and check whether seats are available. Do not purchase, reserve, confirm, or create anything.'), false)
assert.equal(shouldAttemptNaturalAssetRetrieval('Open the bus booking page and check available Bengaluru to Mysuru buses. Do not book, pay, or create anything.'), false)
assert.equal(shouldAttemptNaturalAssetRetrieval('Open the hotel booking page and check room availability. Do not reserve, pay, or confirm anything.'), false)

// Natural named-asset retrieval remains available when the user is genuinely asking
// for a saved object by identity.
assert.equal(shouldAttemptNaturalAssetRetrieval('Show me Jopasu Dashboard & Tyre Polish'), true)
assert.equal(shouldAttemptNaturalAssetRetrieval('Find my Jopasu polish'), true)
assert.equal(shouldAttemptNaturalAssetRetrieval('Send me the Mythili sales estimate'), true)

// Explicit asset-shaped retrieval is still allowed even if the wording mentions an
// operational domain, because the object requested is unambiguously a saved file.
assert.equal(shouldAttemptNaturalAssetRetrieval('Open my flight invoice document'), true)
assert.equal(shouldAttemptNaturalAssetRetrieval('Find my hotel receipt'), true)

console.log('✅ Booking context isolation regression passed: operational flows cannot be hijacked by stale Asset Memory')
