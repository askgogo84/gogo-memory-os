// 11 Nov live (dashboard): the fallback's live-search link became "detail withheld]%20for%201%20adult…" because
// "%20" + "2026-12-20" reads as a 12-digit identifier. Links people open encode spaces as "+", and survive redaction.
import assert from 'node:assert/strict'
const { redactSecretShapedText } = await import('../lib/bot/memory-redaction.ts')
const t = await import('../lib/agent/travel-browser-task.ts')
const r = await import('../lib/agent/travel-research.ts')
const rt = { origin: { code: 'BLR', label: 'Bengaluru' }, destination: { code: 'GOI', label: 'Goa' }, startDate: '2026-12-20', returnDate: '2026-12-22', roundTrip: true, routeLabel: 'BLR → GOI', whenLabel: '20 Dec 2026', adults: 1, cabin: 'economy' }
const ow = { ...rt, returnDate: undefined, roundTrip: false }
for (const link of [t.roundTripSearchLink(rt), t.oneWaySearchLink(ow), r.googleFlightsSearchUrl(ow as any)]) {
  assert.doesNotMatch(link, /%20/); assert.match(link, /2026-12-20/)
  assert.equal(redactSecretShapedText(link), link, link)
  assert.equal(new URL(link).searchParams.get('q')!.includes('2026-12-20'), true)
}
// Control: the old encoding is what the redaction broke.
assert.notEqual(redactSecretShapedText(t.roundTripSearchLink(rt).replace(/\+/g, '%20')), t.roundTripSearchLink(rt).replace(/\+/g, '%20'))
console.log('PASS flight search links survive redaction')
