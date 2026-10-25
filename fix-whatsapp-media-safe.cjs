const fs = require('fs')

const path = 'app/api/webhooks/whatsapp/route.ts'
let file = fs.readFileSync(path, 'utf8')

const oldBlock = `      await saveConversation(resolvedUser.telegramId, 'assistant', finalReply)

      if (directReply.mediaUrl) {
        await sendWhatsAppMediaMessage(from, finalReply, directReply.mediaUrl)
      } else {
        await sendWhatsAppMessage(from, finalReply)
      }

      return new NextResponse(emptyTwiml(), {`

const newBlock = `      await saveConversation(resolvedUser.telegramId, 'assistant', finalReply)

      // Always send text first so the user never gets a silent failure.
      await sendWhatsAppMessage(from, finalReply)

      // Then try optional media as a separate WhatsApp message.
      // If GIF/media fails, text has already reached the user.
      if (directReply.mediaUrl) {
        try {
          await sendWhatsAppMediaMessage(from, ' ', directReply.mediaUrl)
        } catch (mediaError: any) {
          console.error('WHATSAPP_PREMIUM_MEDIA_FAILED:', {
            mediaUrl: directReply.mediaUrl,
            error: mediaError?.message || mediaError,
          })
        }
      }

      return new NextResponse(emptyTwiml(), {`

if (!file.includes(oldBlock)) {
  console.error('❌ Could not find existing media send block. No changes made.')
  process.exit(1)
}

file = file.replace(oldBlock, newBlock)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ Patched WhatsApp direct premium replies to text-first media-safe mode')
