const fs = require('fs')

const path = 'app/api/webhooks/whatsapp/route.ts'
let file = fs.readFileSync(path, 'utf8')

file = file.replace(
/async function sendThinkingIfNeeded\(from: string, text: string\) \{[\s\S]*?\n\}/,
`async function sendThinkingIfNeeded(from: string, text: string) {
  if (!shouldSendThinkingMedia(text)) return

  try {
    await sendWhatsAppMessage(from, '🧘 Working on it…')
  } catch (error: any) {
    console.error('WHATSAPP_THINKING_TEXT_FAILED:', {
      error: error?.message || error,
    })
  }
}`
)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ Thinking state changed to text-only')
