// 2 Nov live: "what's on my schedule today" fell through to general chat on the dashboard.
import assert from 'node:assert/strict'
const { detectDashboardDayIntent } = await import('../lib/dashboard/day-chat')
const { isScheduledListQuery } = await import('../lib/agent/scheduled-list')
for (const t of ["what's on my schedule today", 'What is on my agenda for today?', 'my schedule today', "today's schedule", 'show me my schedule for today', "what's on my plate today", 'what do I have today'])
  assert.equal(detectDashboardDayIntent(t), 'summary', t)
for (const t of ["what's scheduled", 'plan my day', 'schedule a meeting today with Divya', "what's on my calendar tomorrow"])
  assert.notEqual(detectDashboardDayIntent(t), 'summary', t)
assert.equal(isScheduledListQuery("what's on my schedule today"), false, 'the day summary, not the scheduled list')
console.log('✓ "what\'s on my schedule today" reaches the day summary; the scheduled list and calendar phrasing are unchanged')
