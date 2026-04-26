import { sendWhatsApp, sendWhatsAppTypingIndicator } from '@/lib/whatsapp'

export async function sendWhatsAppMessage(phone: string, text: string) {
  await sendWhatsApp(phone, text)
}

export async function sendWhatsAppMediaMessage(phone: string, text: string, mediaUrl?: string | null) {
  await sendWhatsApp(phone, text, mediaUrl)
}

export async function sendWhatsAppTyping(messageSid?: string | null) {
  await sendWhatsAppTypingIndicator(messageSid)
}
