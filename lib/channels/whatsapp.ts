import { sendWhatsApp, sendWhatsAppTypingIndicator } from '@/lib/whatsapp'
import { currentCostContext } from '@/lib/services/cost-context'
import { recordCostEvent } from '@/lib/services/cost-guard'

export function sanitizeWhatsAppReply(text:string){
  const raw=String(text||'')
  if(/^\s*something\s+went\s+wrong\s*(?:[—-]\s*try\s+once\s+more\??)?\s*$/i.test(raw)){
    return `I couldn't finish that request just now because one of my services was temporarily unavailable. Your request wasn't saved as the wrong thing — send it once more and I'll continue.`
  }
  return raw
}

async function recordTransportCost(kind:'text'|'media'){
  const context=currentCostContext()
  if(!context?.telegramId)return
  await recordCostEvent({
    telegramId:context.telegramId,
    category:'whatsapp_outbound',
    metadata:{surface:context.surface||'unknown',kind,source:'whatsapp_channel'},
  })
}

export async function sendWhatsAppMessage(phone: string, text: string) {
  await sendWhatsApp(phone, sanitizeWhatsAppReply(text))
  await recordTransportCost('text')
}

export async function sendWhatsAppMediaMessage(phone: string, text: string, mediaUrl?: string | null) {
  await sendWhatsApp(phone, sanitizeWhatsAppReply(text), mediaUrl)
  await recordTransportCost('media')
}

export async function sendWhatsAppTyping(messageSid?: string | null) {
  await sendWhatsAppTypingIndicator(messageSid)
}
