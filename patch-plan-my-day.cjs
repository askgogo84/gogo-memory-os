const fs = require('fs')

const path = 'lib/bot/process-message.ts'
let file = fs.readFileSync(path, 'utf8')

if (!file.includes("buildPlanMyDayReply")) {
  file = file.replace(
    "import { buildCalendarActionReply, isCalendarAction } from './handlers/calendar-actions'",
    "import { buildCalendarActionReply, isCalendarAction } from './handlers/calendar-actions'\nimport { buildPlanMyDayReply, isPlanMyDayIntent } from './handlers/plan-my-day'"
  )
}

if (!file.includes("PIM:plan my day")) {
  file = file.replace(
`  // PIM:calendar action
  // Important: calendar commands must run before reminder parsing.
  // Example: "Add meeting with Rahul tomorrow at 4 pm" should create a calendar event, not a reminder.`,
`  // PIM:plan my day
  if (isPlanMyDayIntent(incomingText)) {
    const reply = await buildPlanMyDayReply(resolvedUser.telegramId, resolvedUser.name)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  // PIM:calendar action
  // Important: calendar commands must run before reminder parsing.
  // Example: "Add meeting with Rahul tomorrow at 4 pm" should create a calendar event, not a reminder.`
  )
}

fs.writeFileSync(path, file, 'utf8')
console.log('✅ Plan My Day v1 patched into process-message.ts')
