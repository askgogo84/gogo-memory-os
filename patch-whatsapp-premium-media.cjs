const fs = require('fs')

const path = 'app/api/webhooks/whatsapp/route.ts'
let file = fs.readFileSync(path, 'utf8')

file = file.replace(
  "import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'",
  "import { sendWhatsAppMessage, sendWhatsAppMediaMessage } from '@/lib/channels/whatsapp'"
)

file = file.replace(
`      await saveConversation(resolvedUser.telegramId, 'assistant', finalReply)
      await sendWhatsAppMessage(from, finalReply)

      return new NextResponse(emptyTwiml(), {`,
`      await saveConversation(resolvedUser.telegramId, 'assistant', finalReply)

      if (directReply.mediaUrl) {
        await sendWhatsAppMediaMessage(from, finalReply, directReply.mediaUrl)
      } else {
        await sendWhatsAppMessage(from, finalReply)
      }

      return new NextResponse(emptyTwiml(), {`
)

fs.writeFileSync(path, file, 'utf8')
console.log('✅ WhatsApp webhook patched for optional premium media')
