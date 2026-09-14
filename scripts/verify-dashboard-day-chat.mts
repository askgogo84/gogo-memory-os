import { detectDashboardDayIntent, formatDashboardDayReply } from '../lib/dashboard/day-chat'
import { detectReadOnlyScheduleRequest } from '../lib/agent/read-only-schedule'

let failed = 0

const intentCases: Array<[string, 'summary' | 'next' | null]> = [
  ['What do I have today?', 'summary'],
  ['Brief my day', 'summary'],
  ['Plan my day', 'summary'],
  ["What's on today?", 'summary'],
  ["What's next?", 'next'],
  ['Find cheap flights to Mumbai', null],
  ['Sunrise time today', null],
]

for (const [text, expected] of intentCases) {
  const got = detectDashboardDayIntent(text)
  if (got !== expected) {
    failed++
    console.error(`✗ intent ${JSON.stringify(text)} got=${got} expected=${expected}`)
  } else {
    console.log(`✓ ${JSON.stringify(text)} → ${got ?? 'fall through'}`)
  }
}

const readOnlyCases = [
  'Check what I have tomorrow and tell me what needs my attention. Do not change anything.',
  "Tell me what's on tomorrow. Don't change my calendar.",
  'Review my schedule tomorrow without changing anything.',
  'Summarize tomorrow for me, read-only.',
]
for (const text of readOnlyCases) {
  const got = detectReadOnlyScheduleRequest(text)
  if (got?.horizon !== 'tomorrow') {
    failed++
    console.error(`✗ read-only schedule guard missed ${JSON.stringify(text)}`)
  } else console.log(`✓ read-only tomorrow guard → ${JSON.stringify(text)}`)
}

for (const text of [
  'Remind me tomorrow at 9 AM to call Praveen',
  'Create a calendar event tomorrow at 4 PM',
  'Move my meeting tomorrow to 5 PM',
]) {
  if (detectReadOnlyScheduleRequest(text)) {
    failed++
    console.error(`✗ read-only guard incorrectly swallowed mutation ${JSON.stringify(text)}`)
  } else console.log(`✓ mutation remains outside read-only guard → ${JSON.stringify(text)}`)
}

const reply = formatDashboardDayReply({
  intent: 'summary',
  tz: 'Asia/Kolkata',
  now: new Date('2026-09-10T06:00:00Z'),
  remindersOk: true,
  reminders: [
    { id: 1, message: 'Drink water', remind_at: '2026-09-10T12:30:00Z', timezone: 'Asia/Kolkata', recurring_pattern: null, is_recurring: false, sent: false, sent_at: null },
    { id: 2, message: 'Already done', remind_at: '2026-09-10T04:00:00Z', timezone: 'Asia/Kolkata', recurring_pattern: null, is_recurring: false, sent: true, sent_at: '2026-09-10T04:01:00Z' },
  ],
  calendarOk: true,
  calendarConnected: true,
  calendarEvents: [{ id:'cal-1', title:'Team sync', time:'4:00 PM' }],
})

const mustContain = ['Here’s your day:', 'Reminders: 1 left.', 'Drink water', 'Calendar: 1 event.', 'Team sync']
const mustNotContain = ['http://', 'https://', 'Google Calendar Help', 'Sunrise', '**', 'Reply “more”']

for (const text of mustContain) {
  if (!reply.includes(text)) {
    failed++
    console.error(`✗ day reply missing ${JSON.stringify(text)}\n${reply}`)
  }
}
for (const text of mustNotContain) {
  if (reply.includes(text)) {
    failed++
    console.error(`✗ day reply contains forbidden public/markdown text ${JSON.stringify(text)}\n${reply}`)
  }
}

if (!failed) console.log('✓ personal day reply is private, concise and dashboard-shaped')

if (failed) process.exit(1)
console.log('✅ Dashboard day + read-only schedule routing checks passed')
