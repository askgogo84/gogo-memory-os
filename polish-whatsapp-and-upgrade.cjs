const fs = require('fs')

const detectPath = 'lib/bot/detect-intent.ts'
let detect = fs.readFileSync(detectPath, 'utf8')

if (!detect.includes("| 'upgrade_plan'")) {
  detect = detect.replace(
    "| 'set_briefing_time'\n  | 'save_memory'",
    "| 'set_briefing_time'\n  | 'upgrade_plan'\n  | 'save_memory'"
  )
}

if (!detect.includes("return { type: 'upgrade_plan'")) {
  detect = detect.replace(
    "if (!lower) return { type: 'general_chat', confidence: 'low' }\n",
    `if (!lower) return { type: 'general_chat', confidence: 'low' }

  if (
    lower === '/upgrade' ||
    lower === 'upgrade' ||
    lower === 'pricing' ||
    lower === 'plans' ||
    lower === 'payment' ||
    lower.includes('paid plan') ||
    lower.includes('subscribe') ||
    lower.includes('razorpay')
  ) {
    return { type: 'upgrade_plan', confidence: 'high' }
  }
`
  )
}

fs.writeFileSync(detectPath, detect, 'utf8')


const processPath = 'lib/bot/process-message.ts'
let processFile = fs.readFileSync(processPath, 'utf8')

if (!processFile.includes("import { buildUpgradeReply } from './handlers/upgrade'")) {
  processFile = processFile.replace(
    "import { buildDirectWebAnswer } from './handlers/web-answer'",
    "import { buildDirectWebAnswer } from './handlers/web-answer'\nimport { buildUpgradeReply } from './handlers/upgrade'"
  )
}

if (!processFile.includes("intent.type === 'upgrade_plan'")) {
  processFile = processFile.replace(
    "console.log('PIM:before limit')",
    `if (intent.type === 'upgrade_plan') {
    const reply = styleReplyByIntent('upgrade_plan', buildUpgradeReply())
    await saveConversation(resolvedUser.telegramId, 'assistant', reply)
    return { text: formatOutgoingText(params.channel, reply), resolvedUser }
  }

  console.log('PIM:before limit')`
  )
}

fs.writeFileSync(processPath, processFile, 'utf8')

console.log('✅ WhatsApp polish + upgrade beta flow patched')
