const fs = require('fs')

const path = 'app/api/cron/reminders/route.ts'
let file = fs.readFileSync(path, 'utf8')

// Handle current reminder variable name: reminder
file = file.replace(
/const reminderText = `⏰ \*Reminder\*\\n\\n\$\{reminder\.message\}[\s\S]*?`\n\n    try \{/,
`const reminderText = \`⏰ *Reminder*\\n\\n\${String(reminder.message || 'Reminder').replace(/^to\\\\s+/i, '').trim()}\\n\\nQuick actions:\\n• snooze 10 mins\\n• move it to 8 pm\\n• done\${reminder.is_recurring ? \`\\n\\nRepeats: \${reminder.recurring_pattern}\` : ''}\`

    try {`
)

// Handle older variable name: r, if present
file = file.replace(
/const reminderText = `⏰ \*Reminder\*\\n\\n\$\{r\.message\}[\s\S]*?`\n\n      if \(r\.whatsapp_to\) \{/,
`const reminderText = \`⏰ *Reminder*\\n\\n\${String(r.message || 'Reminder').replace(/^to\\\\s+/i, '').trim()}\\n\\nQuick actions:\\n• snooze 10 mins\\n• move it to 8 pm\\n• done\${r.is_recurring ? \`\\n\\nRepeats: \${r.recurring_pattern}\` : ''}\`

      if (r.whatsapp_to) {`
)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ reminder cron delivery copy patched')
