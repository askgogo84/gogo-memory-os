const fs = require('fs')

const path = 'app/api/webhooks/whatsapp/route.ts'
let file = fs.readFileSync(path, 'utf8')

if (!file.includes('ASKGOGO_THINKING_LAYER_V2')) {
  file = file.replace(
`function addVoicePrefix(reply: string, transcript: string) {
  const cleanTranscript =
    transcript.length > 120 ? transcript.slice(0, 117).trim() + '...' : transcript

  return \`🎙️ *Heard you via voice note*\\n“\${cleanTranscript}”\\n\\n\${reply}\`
}
`,
`function addVoicePrefix(reply: string, transcript: string) {
  const cleanTranscript =
    transcript.length > 120 ? transcript.slice(0, 117).trim() + '...' : transcript

  return \`🎙️ *Heard you via voice note*\\n“\${cleanTranscript}”\\n\\n\${reply}\`
}

// ASKGOGO_THINKING_LAYER_V2
function shouldSendThinkingMedia(text: string) {
  const lower = (text || '').toLowerCase().trim()

  return (
    lower === 'today' ||
    lower === 'morning briefing' ||
    lower === 'today briefing' ||
    lower === 'today summary' ||
    lower.includes('show my unread') ||
    lower.includes('unread emails') ||
    lower.includes('latest emails') ||
    lower.includes('latest mail') ||
    lower.includes('reply to latest') ||
    lower.includes('reply to the latest') ||
    lower.includes('summarize my emails') ||
    lower.includes('summarize my mails')
  )
}

async function sendThinkingIfNeeded(from: string, text: string) {
  if (!shouldSendThinkingMedia(text)) return

  // Text first, so user always sees immediate feedback.
  await sendWhatsAppMessage(from, '🧘 Working on it…')

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
}
`
  )
}

if (!file.includes('await sendThinkingIfNeeded(from, text)')) {
  file = file.replace(
`    const result = await processIncomingMessage({
      channel: 'whatsapp',
      externalUserId: from,
      text,
      userName: profileName,
      messageType: incoming.wasVoice ? 'voice' : 'text',
    })`,
`    await sendThinkingIfNeeded(from, text)

    const result = await processIncomingMessage({
      channel: 'whatsapp',
      externalUserId: from,
      text,
      userName: profileName,
      messageType: incoming.wasVoice ? 'voice' : 'text',
    })`
  )
}

fs.writeFileSync(path, file, 'utf8')
console.log('✅ Thinking layer v2 patched')
