const fs = require('fs')

const path = 'lib/bot/process-message.ts'
let file = fs.readFileSync(path, 'utf8')

file = file.replace(
`const reply = \`Your Gmail is not connected yet.\\n\\nConnect it here:\\n\${connectUrl}\``,
`const reply = \`📬 *Connect Gmail*\\n\\nTo show unread emails and draft replies, connect Gmail once.\\n\\n\${connectUrl}\\n\\nAfter connecting, come back and type:\\nshow my unread emails\``
)

file = file.replace(
`const reply = \`Connect your Gmail here:\\n\${connectUrl}\``,
`const reply = \`📬 *Connect Gmail*\\n\\nConnect once to unlock email summaries and reply drafts.\\n\\n\${connectUrl}\``
)

file = file.replace(
`if (intent.type === 'morning_briefing') {
    const reply = await buildMorningBriefing(resolvedUser.telegramId, resolvedUser.name)
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }`,
`if (intent.type === 'morning_briefing') {
    const reply = await buildMorningBriefing(resolvedUser.telegramId, resolvedUser.name)
    const styledReply = styleReplyByIntent('morning_briefing', reply)
    await saveConversation(resolvedUser.telegramId, 'assistant', styledReply)
    return { text: formatOutgoingText(params.channel, styledReply), resolvedUser }
  }`
)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ process-message.ts patched for Gmail + Today style')
