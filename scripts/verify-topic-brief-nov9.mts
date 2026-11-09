// Topic brief (9 Nov): composed only from block data, needs-you first, amber/blue chips render, nothing invented.
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { composeTopicBrief, formatTopicBrief, briefTitle } from '../lib/briefing/topic-brief'
import { BriefCard } from '../components/dashboard/chat-cards'
const now = '2026-11-09T02:00:00.000Z'
const blocks: any = {
  today: { status: 'ok', readAt: now, items: [{ time: 'All day', title: 'Review calendar' }, { time: '11:30am', title: 'Daily Connect-Standup Call' }, { time: '7:30pm', title: 'ONDC| Food Readiness' }] },
  due: { status: 'ok', readAt: now, items: [{ time: '7:00 am', title: 'Stretch' }, { time: '9:00 am', title: 'call Divya' }] },
  loops: { status: 'ok', readAt: now, items: [{ title: 'Reply to IndiaFilings', pill: { text: 'overdue', tone: 'crit' } }, { title: 'Book Goa cab' }] },
  mail: { status: 'ok', readAt: now, items: [{ title: 'API shapes for the pilot', sub: 'Nithin K L · can you share the payload by Monday?' }, { title: 'Invoice', sub: 'WeWork' }] },
  trip: { status: 'empty', message: 'No upcoming trip.', readAt: now },
  exceptions: { status: 'ok', readAt: now, table: { columns: ['Order', 'Outlet', 'Items', 'Waiting'], rows: [['#T1', 'Indiranagar', '2× roll', '26 min'], ['#T2', 'Indiranagar', '1× tea', '9 min'], ['#T3', 'Koramangala', '1× dosa', '4 min']] } },
  oos: { status: 'ok', readAt: now, stats: [{ n: '3', label: 'cancelled out of stock' }, { n: '2', label: 'outlets' }] },
}
const b = composeTopicBrief(blocks, { date: '2026-11-09', now: Date.parse(now), tipplrHref: '/dashboard/spaces/tipplr_exceptions?workspace=x' })
assert.deepEqual(b.items.map(i => `${i.tone}:${i.topic}`), ['needs_you:Tipplr', 'needs_you:Mail', 'needs_you:Open loops', 'handled:Today', 'handled:Reminders'])
assert.equal(b.needsYou, 3)
assert.match(b.items[0].text, /3 orders waiting for a decision at Indiranagar and Koramangala\. Oldest 26 min\./)
assert.match(b.items[1].text, /Nithin K L asked: API shapes for the pilot\. 1 other needs you\./)
assert.match(b.items[3].text, /11:30am Daily Connect-Standup Call, then 2 more\./)
console.log('PASS composition, order, counts')
// errors and empties contribute nothing
const e = composeTopicBrief({ today: { status: 'error', message: 'x' }, mail: { status: 'not_connected', capability: 'email', message: 'x' } } as any, { date: '2026-11-09' })
assert.equal(e.items.length, 0); assert.equal(formatTopicBrief(e), 'Nothing needs you this morning.')
assert.match(formatTopicBrief(b), /^🟠 \*Tipplr\*: 3 orders/); assert.equal(briefTitle('2026-11-09'), 'Morning brief · Mon, 9 Nov')
console.log('PASS empty brief, text form, title')
// card renders chips; a chip with a matching channel opens it, otherwise asks
const html = renderToStaticMarkup(React.createElement(BriefCard, { brief: { ...b, artifactId: 'a1' }, channels: [{ id: 'c1', title: 'Tipplr' }], onOpenChannel: () => {}, onAsk: () => {} }))
assert.match(html, /Morning brief · 3 need you/); assert.match(html, /bg-\[#3a2a10\]/); assert.match(html, /bg-\[#123d38\]/); assert.match(html, /Saved in Make/)
assert.match(html, /href="\/dashboard\/spaces\/tipplr_exceptions\?workspace=x"/)
console.log('verify-topic-brief-nov9: 3 groups passed')
