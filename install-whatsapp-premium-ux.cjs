const fs = require('fs')

function patchDetectIntent() {
  const path = 'lib/bot/detect-intent.ts'
  let file = fs.readFileSync(path, 'utf8')

  const newTypes = [
    'welcome_menu',
    'help_menu',
    'upgrade_plan',
    'referral_flow',
    'notify_me',
  ]

  for (const type of newTypes) {
    const typeLine = `  | '${type}'`
    if (!file.includes(typeLine)) {
      file = file.replace(
        "  | 'set_briefing_time'\n",
        `  | 'set_briefing_time'\n${typeLine}\n`
      )
    }
  }

  const marker = 'ASKGOGO_PREMIUM_WHATSAPP_INTENTS'

  if (!file.includes(marker)) {
    file = file.replace(
      "  if (!lower) return { type: 'general_chat', confidence: 'low' }\n",
      `  if (!lower) return { type: 'general_chat', confidence: 'low' }

  // ${marker}
  if (/^(hi|hello|hey|start|\\/start)$/i.test(lower)) {
    return { type: 'welcome_menu', confidence: 'high' }
  }

  if (
    lower === 'help' ||
    lower === 'menu' ||
    lower === '/help' ||
    lower === 'what can you do' ||
    lower === 'commands'
  ) {
    return { type: 'help_menu', confidence: 'high' }
  }

  if (
    lower === '/upgrade' ||
    lower === 'upgrade' ||
    lower === 'pricing' ||
    lower === 'plans' ||
    lower === 'payment' ||
    lower === 'payments' ||
    lower.includes('paid plan') ||
    lower.includes('subscribe') ||
    lower.includes('razorpay')
  ) {
    return { type: 'upgrade_plan', confidence: 'high' }
  }

  if (
    lower === 'invite' ||
    lower === 'invite friends' ||
    lower === 'refer' ||
    lower === 'referral' ||
    lower === 'share' ||
    lower.includes('invite my friends') ||
    lower.includes('refer friends')
  ) {
    return { type: 'referral_flow', confidence: 'high' }
  }

  if (
    lower === 'notify me' ||
    lower === 'notify me when live' ||
    lower === 'notify me when payment is live' ||
    lower === 'founder offer' ||
    lower === 'founder pricing' ||
    lower.includes('early access')
  ) {
    return { type: 'notify_me', confidence: 'high' }
  }
`
    )
  }

  fs.writeFileSync(path, file, 'utf8')
  console.log('✅ detect-intent.ts patched')
}

function patchProcessMessage() {
  const path = 'lib/bot/process-message.ts'
  let file = fs.readFileSync(path, 'utf8')

  if (!file.includes("import { buildPremiumWhatsappReply } from './handlers/whatsapp-premium'")) {
    file = file.replace(
      "import { buildDirectWebAnswer } from './handlers/web-answer'",
      "import { buildDirectWebAnswer } from './handlers/web-answer'\nimport { buildPremiumWhatsappReply } from './handlers/whatsapp-premium'"
    )
  }

  const marker = 'ASKGOGO_PREMIUM_WHATSAPP_HANDLER'

  if (!file.includes(marker)) {
    file = file.replace(
      "  console.log('PIM:intent', intent)\n",
      `  console.log('PIM:intent', intent)

  // ${marker}
  if (
    intent.type === 'welcome_menu' ||
    intent.type === 'help_menu' ||
    intent.type === 'upgrade_plan' ||
    intent.type === 'referral_flow' ||
    intent.type === 'notify_me'
  ) {
    const reply = buildPremiumWhatsappReply(intent.type, resolvedUser.name)

    await saveConversation(resolvedUser.telegramId, 'user', incomingText)

    if (intent.type === 'notify_me') {
      await saveMemory(
        resolvedUser.telegramId,
        'User asked to be notified for AskGogo founder pricing / paid plan launch.'
      )
    }

    await saveConversation(resolvedUser.telegramId, 'assistant', reply)

    return {
      text: formatOutgoingText(params.channel, reply),
      resolvedUser,
    }
  }
`
    )
  }

  fs.writeFileSync(path, file, 'utf8')
  console.log('✅ process-message.ts patched')
}

function patchReminderCron() {
  const path = 'app/api/cron/reminders/route.ts'
  let file = fs.readFileSync(path, 'utf8')

  if (!file.includes('Quick actions:')) {
    file = file.replace(
      "const reminderText = `⏰ *Reminder*\\n\\n${reminder.message}${",
      "const reminderText = `⏰ *Reminder*\\n\\n${reminder.message}\\n\\nQuick actions:\\n• snooze 10 mins\\n• move it to 8 pm${"
    )

    file = file.replace(
      "const reminderText = `⏰ *Reminder*\\n\\n${r.message}${",
      "const reminderText = `⏰ *Reminder*\\n\\n${r.message}\\n\\nQuick actions:\\n• snooze 10 mins\\n• move it to 8 pm${"
    )
  }

  fs.writeFileSync(path, file, 'utf8')
  console.log('✅ reminder cron quick actions patched')
}

patchDetectIntent()
patchProcessMessage()
patchReminderCron()

console.log('✅ AskGogo Premium WhatsApp UX Pack installed safely')
