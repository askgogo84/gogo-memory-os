import assert from 'node:assert/strict'
import { needsBrainContext, resolveContextualTurnDeterministically, type BrainSnapshot } from '../lib/agent/brain-context'

const snapshot:BrainSnapshot={
  focus:{kind:'trip',ref:'trip:B8XIQC',summary:'Bengaluru to New York, 2026-09-27, flights EY239 / EY1, booking B8XIQC',bookingGroup:'B8XIQC'},
  recentTrips:[
    {bookingGroup:'B8XIQC',from:'Bengaluru',to:'Abu Dhabi',departAt:'2026-09-27T16:45:00.000Z',flightNo:'EY239',airline:'Etihad',pnr:'B8XIQC'},
    {bookingGroup:'B8XIQC',from:'Abu Dhabi',to:'New York',departAt:'2026-09-27T21:05:00.000Z',flightNo:'EY1',airline:'Etihad',pnr:'B8XIQC'},
  ],
  recentRuns:[],
  recentConversation:[
    {role:'assistant',content:'Flight ticket saved for Bengaluru to New York.'},
  ],
  vault:[
    {provider:'booking.com',domains:['booking.com'],status:'active',accountLabel:'Travel'},
    {provider:'amazon',domains:['amazon.in'],status:'needs_reauth',accountLabel:'Personal'},
  ],
}

assert.equal(needsBrainContext('Save it my calendar'),true)
assert.equal(needsBrainContext('Monitor it and tell me if anything changes'),true)
assert.equal(needsBrainContext('Book it'),true)
assert.equal(needsBrainContext('What is the weather in Bengaluru today?'),false)

const calendar=resolveContextualTurnDeterministically('Save it my calendar',snapshot)
assert.ok(calendar)
assert.equal(calendar?.actionFamily,'calendar')
assert.equal(calendar?.usedContext,true)
assert.match(calendar?.resolvedText||'',/^Find my latest flight trip/)
assert.match(calendar?.resolvedText||'',/Bengaluru to New York/)
assert.match(calendar?.resolvedText||'',/EY239 \/ EY1/)
assert.match(calendar?.resolvedText||'',/B8XIQC/)

const monitor=resolveContextualTurnDeterministically('Monitor it and tell me if anything changes',snapshot)
assert.equal(monitor?.actionFamily,'monitor')
assert.match(monitor?.resolvedText||'',/^Monitor my latest flight trip/)

const book=resolveContextualTurnDeterministically('Book it',snapshot)
assert.equal(book?.actionFamily,'book')
assert.match(book?.resolvedText||'',/Continue the same user outcome/)
assert.doesNotMatch(book?.resolvedText||'',/password|otp|secret|username/i)

// Vault is present in the snapshot as metadata only; the resolver must never
// interpolate credential metadata into the contextual rewrite.
assert.doesNotMatch(calendar?.resolvedText||'',/booking\.com|amazon\.in|Travel|Personal/)

console.log('unified brain context verification passed')
