const fs = require('fs')

const detectPath = 'lib/bot/detect-intent.ts'
const processPath = 'lib/bot/process-message.ts'

let detect = fs.readFileSync(detectPath, 'utf8')
let processFile = fs.readFileSync(processPath, 'utf8')

// 1) Make sure premium WhatsApp intent types exist in IntentType
const premiumTypes = [
  'welcome_menu',
  'help_menu',
  'upgrade_plan',
  'referral_flow',
  'notify_me',
]

for (const type of premiumTypes) {
  const line = `  | '${type}'`

  if (!detect.includes(line)) {
    detect = detect.replace(
      "  | 'set_briefing_time'\n",
      "  | 'set_briefing_time'\n" + line + "\n"
    )
  }
}

// 2) Make sure detectIntent actually detects these before general logic
if (!detect.includes('ASKGOGO_FORCE_PREMIUM_INTENTS')) {
  detect = detect.replace(
    "  if (!lower) return { type: 'general_chat', confidence: 'low' }\n",
    `  if (!lower) return { type: 'general_chat', confidence: 'low' }

  // ASKGOGO_FORCE_PREMIUM_INTENTS
  if (/^(hi|hello|hey|start|\\/start)$/i.test(lower)) {
    return { type: 'welcome_menu', confidence: 'high' }
  }

  if (
    lower === 'help' ||
    lower === '/help' ||
    lower === 'menu' ||
    lower === 'commands' ||
    lower === 'what can you do'
  ) {
    return { type: 'help_menu', confidence: 'high' }
  }

  if (
    lower === 'pricing' ||
    lower === 'price' ||
    lower === 'plans' ||
    lower === 'plan' ||
    lower === 'upgrade' ||
    lower === '/upgrade' ||
    lower === 'payment' ||
    lower === 'payments' ||
    lower.includes('razorpay')
  ) {
    return { type: 'upgrade_plan', confidence: 'high' }
  }

  if (
    lower === 'notify me' ||
    lower === 'notify' ||
    lower === 'notify me when live' ||
    lower === 'notify me when payment is live' ||
    lower === 'founder offer' ||
    lower === 'founder pricing' ||
    lower.includes('early access')
  ) {
    return { type: 'notify_me', confidence: 'high' }
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
`
  )
}

// 3) Remove old duplicate upgrade block from process-message.ts
processFile = processFile.replace(
`  if (intent.type === 'upgrade_plan') {
    const reply = styleReplyByIntent('upgrade_plan', buildUpgradeReply())
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

`,
''
)

// 4) Remove unused buildUpgradeReply import if present
processFile = processFile.replace(
"import { buildUpgradeReply } from './handlers/upgrade'\n",
''
)

fs.writeFileSync(detectPath, detect, 'utf8')
fs.writeFileSync(processPath, processFile, 'utf8')

console.log('✅ Fixed premium intent TypeScript build issue')
