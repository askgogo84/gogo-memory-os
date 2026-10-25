const fs = require('fs')

const path = 'lib/bot/process-message.ts'
let file = fs.readFileSync(path, 'utf8')

// Premium sports reminder confirmation
file = file.replace(
`      let reply = ''
      if (lower.includes('1 hour before')) {
        reply = \`Done — I'll remind you 1 hour before *\${latestSportsFollowup.payload.match_label}*.\`
      } else if (lower.includes('2 hours before')) {
        reply = \`Done — I'll remind you 2 hours before *\${latestSportsFollowup.payload.match_label}*.\`
      } else if (lower.includes('tomorrow morning')) {
        reply = \`Done — I'll remind you tomorrow morning about *\${latestSportsFollowup.payload.match_label}*.\`
      } else {
        reply = \`Done — I'll remind you before *\${latestSportsFollowup.payload.match_label}*.\`
      }`,
`      let timingLabel = '1 hour before the match'
      if (lower.includes('2 hours before')) {
        timingLabel = '2 hours before the match'
      } else if (lower.includes('tomorrow morning')) {
        timingLabel = 'tomorrow morning'
      }

      const reply = \`✅ *Match reminder set*\\n\\n\${latestSportsFollowup.payload.match_label}\\n\${timingLabel}\``
)

// Cleaner Gmail reconnect copy
file = file.replace(
`const reply = \`I couldn't fetch your emails right now.\\n\\nTry reconnecting Gmail here:\\n\${connectUrl}\``,
`const reply = \`📬 *Gmail needs reconnecting*\\n\\nI couldn’t fetch your emails right now.\\n\\nReconnect Gmail here:\\n\${connectUrl}\\n\\nThen type:\\nshow my unread emails\``
)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ process-message.ts polished')
