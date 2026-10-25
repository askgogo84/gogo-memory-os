const fs = require('fs')

const path = 'lib/bot/process-message.ts'
let file = fs.readFileSync(path, 'utf8')

if (!file.includes("buildCalendarActionReply")) {
  file = file.replace(
    "import { buildPremiumWhatsappReply } from './handlers/whatsapp-premium'",
    "import { buildPremiumWhatsappReply } from './handlers/whatsapp-premium'\nimport { buildCalendarActionReply, isCalendarAction } from './handlers/calendar-actions'"
  )
}

if (!file.includes("PIM:calendar action")) {
  file = file.replace(
`  if (intent.type === 'set_briefing_time') {
    const reply = await setBriefingTime(resolvedUser.telegramId, incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }`,
`  if (intent.type === 'set_briefing_time') {
    const reply = await setBriefingTime(resolvedUser.telegramId, incomingText)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  // PIM:calendar action
  if (isCalendarAction(incomingText)) {
    const calendarResult = await buildCalendarActionReply(resolvedUser.telegramId, incomingText)

    if (calendarResult.handled) {
      await saveConversation(resolvedUser.telegramId, 'assistant', calendarResult.reply)
      return { text: formatOutgoingText(params.channel, calendarResult.reply), resolvedUser }
    }
  }`
  )
}

fs.writeFileSync(path, file, 'utf8')
console.log('✅ Calendar Power Pack v1 patched into process-message.ts')
