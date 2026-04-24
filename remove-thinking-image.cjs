const fs = require('fs')

const path = 'app/api/webhooks/whatsapp/route.ts'
let file = fs.readFileSync(path, 'utf8')

const oldFn = `async function sendThinkingIfNeeded(from: string, text: string) {
  if (!shouldSendThinkingMedia(text)) return

  try {
    await sendWhatsAppMessage(from, '🧘 Working on it…')
  } catch (error: any) {
    console.error('WHATSAPP_THINKING_TEXT_FAILED:', {
      error: error?.message || error,
    })
  }

  const thinkingUrl = process.env.ASKGOGO_THINKING_GIF_URL

  if (!thinkingUrl) return

  try {
    await sendWhatsAppMediaMessage(from, ' ', thinkingUrl)
  } catch (error: any) {
    console.error('WHATSAPP_THINKING_MEDIA_FAILED:', {
      mediaUrl: thinkingUrl,
      error: error?.message || error,
    })
  }
}`

const newFn = `async function sendThinkingIfNeeded(from: string, text: string) {
  if (!shouldSendThinkingMedia(text)) return

  try {
    await sendWhatsAppMessage(from, '🧘 Working on it…')
  } catch (error: any) {
    console.error('WHATSAPP_THINKING_TEXT_FAILED:', {
      error: error?.message || error,
    })
  }
}`

if (!file.includes(oldFn)) {
  console.error('Could not find exact thinking function block.')
  process.exit(1)
}

file = file.replace(oldFn, newFn)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ Removed thinking media, kept text-only thinking state')
