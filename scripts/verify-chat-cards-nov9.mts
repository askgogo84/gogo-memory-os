// Chat cards (9 Nov): work cards come only from real Make links; titles never read as sentences; the inline approvals
// render the same card as Tasks and hide deferred ones. The chat module still renders.
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { reportIdsIn, workTitleFrom, WorkCards, InlineApprovals } from '../components/dashboard/chat-cards'
const id = '6c0b1a6e-2b2f-4a44-9a4e-7a3b4c1d2e3f'
assert.deepEqual(reportIdsIn(`Tipplr weekly\n\nOrders up 11%.\n\nPrivate report: https://app.askgogo.in/dashboard/reports/${id}\nhttps://app.askgogo.in/dashboard/reports/${id}`), [id])
assert.deepEqual(reportIdsIn('see https://evil.example/dashboard/reports/' + id), [])
assert.equal(workTitleFrom('Tipplr weekly\n\nOrders up 11%.'), 'Tipplr weekly')
assert.equal(workTitleFrom('Here is what I found this week.'), 'What Gogo made')
const html = renderToStaticMarkup(React.createElement(WorkCards, { text: `*Tipplr weekly*\nhttps://app.askgogo.in/dashboard/reports/${id}`, createdAt: '2026-11-09T01:42:00Z' }))
assert.match(html, new RegExp(`href="/dashboard/reports/${id}"`)); assert.match(html, /Tipplr weekly/); assert.match(html, /Made 7:12 am/)
assert.equal(renderToStaticMarkup(React.createElement(WorkCards, { text: 'no links here' })), '')
const approvals = [
  { id: 'a1', runId: 'r1', actionType: 'booking', title: 'Book Savaari cab ₹1,650', description: 'Goa trip', preview: [{ label: 'Passenger', value: 'Goverdhan' }], risk: 'medium', expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString() /* was a fixed 10 Nov 01:00 UTC: expired at that time and the card lost its Later button */, deferredUntil: null },
  { id: 'a2', runId: 'r2', actionType: 'email', title: 'Send reply to Nithin', deferredUntil: '2026-11-09T09:00:00Z' },
]
const h2 = renderToStaticMarkup(React.createElement(InlineApprovals, { approvals }))
assert.match(h2, /Needs you · 1/); assert.match(h2, /Book Savaari cab/); assert.doesNotMatch(h2, /Send reply to Nithin/, 'deferred cards stay out of the thread')
assert.match(h2, /Later/); assert.match(h2, /Don’t|Don't/)
console.log('verify-chat-cards-nov9: 9 passed')
