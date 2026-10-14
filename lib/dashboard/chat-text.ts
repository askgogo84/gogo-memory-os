// Gogo's replies are written once and sent to WhatsApp, where *word* means bold. On the dashboard those
// asterisks showed up as literal characters ("*Bangalore now*"). This splits a reply into plain and bold pieces so
// the page can draw real bold. Only a pair of asterisks hugging text on one line counts; a bullet ("* item"),
// a lone asterisk or a multiplication sign is left alone. Bold only: no italics anywhere.
export type ChatTextPart = { bold: boolean; text: string }

const BOLD = /\*(?=\S)([^*\n]+?)(?<=\S)\*/g

export function splitChatText(input: string): ChatTextPart[] {
  const text = String(input ?? '')
  const parts: ChatTextPart[] = []
  let last = 0
  for (const match of text.matchAll(BOLD)) {
    const at = match.index ?? 0
    if (at > last) parts.push({ bold: false, text: text.slice(last, at) })
    parts.push({ bold: true, text: match[1] })
    last = at + match[0].length
  }
  if (last < text.length) parts.push({ bold: false, text: text.slice(last) })
  return parts.length ? parts : [{ bold: false, text }]
}
