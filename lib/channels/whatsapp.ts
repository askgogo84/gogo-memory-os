import { sendWhatsApp } from '@/lib/whatsapp'

export async function sendWhatsAppMessage(phone: string, text: string) {
  await sendWhatsApp(phone, text)
}

