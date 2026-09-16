import { sendWhatsApp, sendWhatsAppCalendarApprovalButtons, sendWhatsAppTypingIndicator } from '@/lib/whatsapp'

// Product invariant: users should never receive the exact raw/generic infrastructure
// failure copy. Anchor the guard to the entire reply so legitimate explanations,
// drafts, quotations, or actionable error messages containing the same words survive.
export function sanitizeWhatsAppReply(text:string){
  const raw=String(text||'')
  if(/^\s*something\s+went\s+wrong\s*(?:[—-]\s*try\s+once\s+more\??)?\s*$/i.test(raw)){
    return `I couldn't finish that request just now because one of my services was temporarily unavailable. Your request wasn't saved as the wrong thing — send it once more and I'll continue.`
  }
  return raw
}

function parseCalendarApproval(text: string): { title: string; when: string; duration: string } | null {
  const raw = String(text || '')
  if (!/Ready to add\s*[—-]\s*approval required/i.test(raw)) return null

  const lines = raw
    .replace(/\*/g, '')
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)

  const headerIndex = lines.findIndex((x) => /Ready to add\s*[—-]\s*approval required/i.test(x))
  if (headerIndex < 0) return null

  const after = lines.slice(headerIndex + 1)
  const durationIndex = after.findIndex((x) => /^Duration:/i.test(x))
  if (durationIndex < 2) return null

  const title = after[0]
  const when = after[1]
  const duration = after[durationIndex].replace(/^Duration:\s*/i, '').trim() || '30 mins'
  if (!title || !when) return null

  return { title, when, duration }
}

export async function sendWhatsAppMessage(phone: string, text: string) {
  const clean = sanitizeWhatsAppReply(text)
  const approval = parseCalendarApproval(clean)
  if (approval) {
    await sendWhatsAppCalendarApprovalButtons(phone, approval.title, approval.when, approval.duration)
    return
  }
  await sendWhatsApp(phone, clean)
}

export async function sendWhatsAppMediaMessage(phone: string, text: string, mediaUrl?: string | null) {
  await sendWhatsApp(phone, sanitizeWhatsAppReply(text), mediaUrl)
}

export async function sendWhatsAppTyping(messageSid?: string | null) {
  await sendWhatsAppTypingIndicator(messageSid)
}
