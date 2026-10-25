const fs = require('fs')

const path = 'lib/bot/process-message.ts'
let file = fs.readFileSync(path, 'utf8')

file = file.replace(
`await createReminder(
        resolvedUser.telegramId,
        resolvedUser.telegramId,
        remindAt.toISOString(),
        reminderMessage
      )`,
`await createReminder(
        resolvedUser.telegramId,
        resolvedUser.telegramId,
        remindAt.toISOString(),
        reminderMessage,
        undefined,
        params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
      )`
)

file = file.replace(
`await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      eagerReminder.remindAtIso,
      eagerReminder.message,
      eagerReminder.kind === 'recurring' ? eagerReminder.pattern : undefined
    )`,
`await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      eagerReminder.remindAtIso,
      eagerReminder.message,
      eagerReminder.kind === 'recurring' ? eagerReminder.pattern : undefined,
      params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
    )`
)

file = file.replace(
`await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      parsed.remindAt,
      parsed.message,
      parsed.pattern
    )`,
`await createReminder(
      resolvedUser.telegramId,
      resolvedUser.telegramId,
      parsed.remindAt,
      parsed.message,
      parsed.pattern,
      params.channel === 'whatsapp' ? resolvedUser.whatsappId : null
    )`
)

const required = "params.channel === 'whatsapp' ? resolvedUser.whatsappId : null"
const count = (file.match(new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length

if (count < 3) {
  console.error('❌ WhatsApp reminder patch incomplete. Found only ' + count + ' WhatsApp reminder call(s).')
  process.exit(1)
}

fs.writeFileSync(path, file, 'utf8')
console.log('✅ process-message.ts patched. WhatsApp reminder call count:', count)
