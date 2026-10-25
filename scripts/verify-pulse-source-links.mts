// Every surfaced attention item links to its source (Duet reviewers' "silent omission" worry). Run: npx tsx scripts/verify-pulse-source-links.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-key'
process.env.OPENAI_API_KEY ||= 'test-key'
const { openLoopSourceLink } = await import('../lib/agent/autonomy-pulse')
assert.equal(openLoopSourceLink({ source_type: 'gmail_thread', source_id: '18f2a9c3b7d1e4f0' }), 'Open email: https://mail.google.com/mail/u/0/#all/18f2a9c3b7d1e4f0')
assert.equal(openLoopSourceLink({ source_type: 'gmail_thread', source_id: 'x"><script>' }), '', 'odd ids never become links')
assert.equal(openLoopSourceLink({ source_type: 'calendar_conflict', source_id: 'overlap:a+b' }), 'Open calendar: https://app.askgogo.in/dashboard/calendar')
assert.equal(openLoopSourceLink({ source_type: 'conversation', source_id: '1' }), '')
assert.match(readFileSync('lib/agent/autonomy-pulse.ts', 'utf8'), /source_type,source_id'\)/)
console.log('Pulse items carry a source link built only from stored ids')

// R03: the measured learning report answers on the dashboard too (before understand-first), and "what have you
// learnt about me" reaches it.
const route = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.ok(route.indexOf('const brainFirst') > 0 && route.indexOf('const brainFirst') < route.indexOf('tryUnderstandFirst({'), 'brain report is checked before understand-first')
assert.match(route, /const understoodReply = brainFirst \? null : await/)
const { isSameBrainIntrospection } = await import('../lib/agent/brain-introspection')
assert.equal(isSameBrainIntrospection('How is Same Brain learning from my outcomes?'), true)
assert.equal(isSameBrainIntrospection('What have you learnt about me?'), true)
assert.equal(isSameBrainIntrospection('Write a post about what I learned today'), false)
console.log('R03: learning report reachable on the dashboard')
