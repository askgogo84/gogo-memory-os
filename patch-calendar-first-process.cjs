const fs = require('fs')

const path = 'lib/bot/process-message.ts'
let file = fs.readFileSync(path, 'utf8')

file = file.replace(
`  if (intent.type === 'connect_calendar') {
    const url = getAuthUrl(resolvedUser.telegramId)
    const reply = \`Connect your Google Calendar here:\\n\${url}\`
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }`,
`  if (intent.type === 'connect_calendar') {
    const url = getAuthUrl(resolvedUser.telegramId)
    const reply = \`📅 *Connect Google Calendar*\\n\\nThis lets AskGogo include your schedule in Today briefing and help you plan reminders better.\\n\\n\${url}\\n\\nAfter connecting, come back and type:\\nToday\`
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }`
)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ process-message.ts calendar copy patched')
