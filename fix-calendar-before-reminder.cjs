const fs = require('fs')

const path = 'lib/bot/process-message.ts'
let file = fs.readFileSync(path, 'utf8')

// Remove existing calendar action block from current position
const calendarBlock = `  // PIM:calendar action
  if (isCalendarAction(incomingText)) {
    const calendarResult = await buildCalendarActionReply(resolvedUser.telegramId, incomingText)

    if (calendarResult.handled) {
      await saveConversation(resolvedUser.telegramId, 'assistant', calendarResult.reply)
      return { text: formatOutgoingText(params.channel, calendarResult.reply), resolvedUser }
    }
  }

`

if (file.includes(calendarBlock)) {
  file = file.replace(calendarBlock, '')
}

// Insert calendar action block BEFORE reminder parsing
const reminderAnchor = `  const eagerReminder = parseReminderIntent(incomingText)
  if (eagerReminder && intent.type === 'set_reminder') {`

const newCalendarBlock = `  // PIM:calendar action
  // Important: calendar commands must run before reminder parsing.
  // Example: "Add meeting with Rahul tomorrow at 4 pm" should create a calendar event, not a reminder.
  if (isCalendarAction(incomingText)) {
    const calendarResult = await buildCalendarActionReply(resolvedUser.telegramId, incomingText)

    if (calendarResult.handled) {
      await saveConversation(resolvedUser.telegramId, 'assistant', calendarResult.reply)
      return { text: formatOutgoingText(params.channel, calendarResult.reply), resolvedUser }
    }
  }

  const eagerReminder = parseReminderIntent(incomingText)
  if (eagerReminder && intent.type === 'set_reminder') {`

if (!file.includes(reminderAnchor)) {
  console.error('❌ Could not find reminder anchor. No changes made.')
  process.exit(1)
}

file = file.replace(reminderAnchor, newCalendarBlock)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ Calendar actions moved before reminder parsing')
