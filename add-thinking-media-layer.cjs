const fs = require('fs')

const path = 'app/api/webhooks/whatsapp/route.ts'
let file = fs.readFileSync(path, 'utf8')

if (!file.includes('function shouldSendThinkingMedia')) {
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

function shouldSendThinkingMedia(text: string) {
  const lower = (text || '').toLowerCase()

  return (
    lower === 'today' ||
    lower === 'morning briefing' ||
    lower.includes('show my unread') ||
    lower.includes('unread emails') ||
    lower.includes('latest emails') ||
    lower.includes('latest mail') ||
    lower.includes('reply to latest') ||
    lower.includes('reply to the latest') ||
    lower.includes('summarize my emails') ||
    lower.includes('summarize my mails') ||
    lower.includes('news') ||
    lower.includes('latest') ||
    lower.includes('search')
  )
}

async function sendThinkingIfNeeded(from: string, text: string) {
  const thinkingUrl = process.env.ASKGOGO_THINKING_GIF_URL

  if (!thinkingUrl || !shouldSendThinkingMedia(text)) {
    return
  }

  try {
    await sendWhatsAppMediaMessage(
      from,
      'Working on it…',
      thinkingUrl
    )
  } catch (error: any) {
    console.error('WHATSAPP_THINKING_MEDIA_FAILED:', {
      error: error?.message || error,
    })

    try {
      await sendWhatsAppMessage(from, 'Working on it…')
    } catch {}
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
console.log('✅ Thinking media layer added to WhatsApp webhook')
