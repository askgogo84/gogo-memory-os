const fs = require('fs')

const path = 'app/api/webhooks/whatsapp/route.ts'
let file = fs.readFileSync(path, 'utf8')

if (!file.includes("normalizeVoicePromptForBot")) {
  file = file.replace(
    "import { getDirectWhatsappPremiumReply } from '@/lib/bot/handlers/whatsapp-direct-premium'",
    "import { getDirectWhatsappPremiumReply } from '@/lib/bot/handlers/whatsapp-direct-premium'\nimport { normalizeVoicePromptForBot } from '@/lib/bot/handlers/voice-normalizer'"
  )
}

file = file.replace(
`    const text = incoming.text.trim()

    if (!text) {`,
`    const originalText = incoming.text.trim()
    const text = incoming.wasVoice ? normalizeVoicePromptForBot(originalText) : originalText

    if (!text) {`
)

file = file.replace(
`        incoming.wasVoice ? \`[voice] \${text}\` : text`,
`        incoming.wasVoice ? \`[voice] \${originalText} -> \${text}\` : text`
)

file = file.replace(
`          ? addVoicePrefix(directReply.text, incoming.voiceTranscript)`,
`          ? addVoicePrefix(directReply.text, originalText)`
)

file = file.replace(
`        ? addVoicePrefix(result.text, incoming.voiceTranscript)`,
`        ? addVoicePrefix(result.text, originalText)`
)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ WhatsApp voice normalizer patched into webhook')
