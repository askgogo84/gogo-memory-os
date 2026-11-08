// Spaces PR 4: the block renderer shows every state without throwing, and never offers a connect link for a block
// the person turned off.
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { SpaceBlocks } from '../components/dashboard/spaces/space-blocks'
import { templateSpace } from '../lib/spaces/schema'

const now = new Date().toISOString()
const space = templateSpace('my_day', { kind: 'user', telegramId: '-884501501' })
const html = renderToStaticMarkup(React.createElement(SpaceBlocks, { space, data: {
  today: { status: 'ok', readAt: now, items: [{ time: '10:00 am', title: 'Standup with Nithin' }] },
  due: { status: 'empty', message: 'No reminders left today.', readAt: now },
  loops: { status: 'error', message: "I couldn't read your open loops just now." },
  mail: { status: 'not_connected', capability: 'email', message: 'Turned off in your permissions (email). Nothing is read.' },
} }))
assert.match(html, /Standup with Nithin/); assert.match(html, /No reminders left today/); assert.match(html, /open loops just now/)
assert.ok(!/href="\/dashboard\/connections"/.test(html), 'no Connect link when the person turned it off')
const html2 = renderToStaticMarkup(React.createElement(SpaceBlocks, { space, data: { mail: { status: 'not_connected', capability: 'email', message: 'Connect Gmail and the emails that need you show here.' } } }))
assert.match(html2, /href="\/dashboard\/connections"/)
const t = templateSpace('tipplr_exceptions', { kind: 'workspace', workspaceId: '7e1b6f4a-2c0d-4b58-9c3e-5a1f0d9b2e77' })
const html3 = renderToStaticMarkup(React.createElement(SpaceBlocks, { space: t, data: { oos: { status: 'ok', readAt: now, stats: [{ n: '3', label: 'cancelled out of stock' }] }, exceptions: { status: 'ok', readAt: now, table: { columns: ['Order', 'Outlet', 'Items', 'Waiting'], rows: [['#T1', 'Indiranagar', '2× Paneer roll', '9 min']] } } } }))
assert.match(html3, /Indiranagar/); assert.match(html3, /Digest arrives at 9:00/)
console.log('verify-spaces-render-nov8: 3 passed')
