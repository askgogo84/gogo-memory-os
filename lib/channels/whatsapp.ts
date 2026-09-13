import { sendWhatsApp, sendWhatsAppTypingIndicator } from '@/lib/whatsapp'

// Product invariant: users should never receive raw/generic infrastructure failure copy.
// Keep this final channel-level guard independent of whichever webhook/agent produced it.
export function sanitizeWhatsAppReply(text:string){
  const raw=String(text||'')
  if(/something\s+went\s+wrong(?:\s*[—-]\s*try\s+once\s+more\??)?/i.test(raw)){
    return `I couldn't finish that request just now because one of my services was temporarily unavailable. Your request wasn't saved as the wrong thing — send it once more and I'll continue.`
  }
  return raw
}

export async function sendWhatsAppMessage(phone: string, text: string) {
  await sendWhatsApp(phone, sanitizeWhatsAppReply(text))
}

export async function sendWhatsAppMediaMessage(phone: string, text: string, mediaUrl?: string | null) {
  await sendWhatsApp(phone, sanitizeWhatsAppReply(text), mediaUrl)
}

export async function sendWhatsAppTyping(messageSid?: string | null) {
  await sendWhatsAppTypingIndicator(messageSid)
}