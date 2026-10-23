// Minimal RFC 822 / MIME reader for forwarded mail: headers, multipart, quoted-printable, base64, RFC 2047 words.
// Enough to get From, To, Subject, Message-ID, list headers and readable text. Attachments are ignored.

export type ParsedMail = {
  headers: Record<string, string>
  from: string
  to: string
  subject: string
  messageId: string
  inReplyTo: string
  references: string
  date: string
  listId: string
  listUnsubscribe: string
  autoSubmitted: string
  precedence: string
  text: string
}

function splitHeadBody(raw: string) {
  const m = raw.match(/\r?\n\r?\n/)
  if (!m || m.index === undefined) return { head: raw, body: '' }
  return { head: raw.slice(0, m.index), body: raw.slice(m.index + m[0].length) }
}

export function parseHeaders(head: string): Record<string, string> {
  const out: Record<string, string> = {}
  const unfolded = head.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    const value = line.slice(i + 1).trim()
    // Keep the first occurrence (the outermost/most recent header block for Received-style repeats is not needed).
    if (!(key in out)) out[key] = value
  }
  return out
}

function charsetDecode(bytes: Uint8Array, charset: string) {
  const cs = (charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '')
  try { return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs, { fatal: false }).decode(bytes) } catch { return new TextDecoder('utf-8').decode(bytes) }
}

function qpBytes(input: string) {
  const s = input.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '=' && /^[0-9A-F]{2}$/i.test(s.slice(i + 1, i + 3))) { bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2 }
    else { const code = s.charCodeAt(i); if (code < 256) bytes.push(code); else for (const b of new TextEncoder().encode(c)) bytes.push(b) }
  }
  return new Uint8Array(bytes)
}

function latin1Bytes(s: string) {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

function isLatin1Bytes(value: string) {
  return /[\u0080-\u00ff]/.test(value) && !/[^\u0000-\u00ff]/.test(value)
}

export function decodeWords(value: string) {
  const v = String(value || '')
  return (isLatin1Bytes(v) ? charsetDecode(latin1Bytes(v), 'utf-8') : v).replace(/=\?([^?]+)\?([bqBQ])\?([^?]*)\?=(\s+(?==\?))?/g, (_m, cs, enc, text) => {
    try {
      const bytes = enc.toUpperCase() === 'B' ? new Uint8Array(Buffer.from(text, 'base64')) : qpBytes(text.replace(/_/g, ' '))
      return charsetDecode(bytes, cs)
    } catch { return text }
  })
}

function param(header: string, name: string) {
  const m = String(header || '').match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|([^;\\s]+))`, 'i'))
  return m ? (m[1] ?? m[2] ?? '') : ''
}

function decodeBody(body: string, encoding: string, charset: string) {
  const enc = (encoding || '7bit').toLowerCase()
  if (enc === 'base64') return charsetDecode(new Uint8Array(Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64')), charset)
  if (enc === 'quoted-printable') return charsetDecode(qpBytes(body), charset)
  // 8bit/7bit/binary: the route passes raw bytes as a latin1 string; decode them with the part's charset.
  return isLatin1Bytes(body) ? charsetDecode(latin1Bytes(body), charset) : body
}

export function htmlToText(html: string) {
  return String(html || '')
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim()
}

type Part = { plain: string; html: string }

function walk(raw: string, depth = 0): Part {
  const { head, body } = splitHeadBody(raw)
  const h = parseHeaders(head)
  const ctype = h['content-type'] || 'text/plain'
  const charset = param(ctype, 'charset') || 'utf-8'
  const enc = h['content-transfer-encoding'] || ''
  if (/^multipart\//i.test(ctype) && depth < 6) {
    const boundary = param(ctype, 'boundary')
    if (!boundary) return { plain: body, html: '' }
    const pieces = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?[ \\t]*\\r?\\n?`))
    const out: Part = { plain: '', html: '' }
    for (const piece of pieces.slice(1)) {
      if (!piece.trim()) continue
      const sub = walk(piece, depth + 1)
      if (!out.plain && sub.plain) out.plain = sub.plain
      if (!out.html && sub.html) out.html = sub.html
    }
    return out
  }
  if (/attachment/i.test(h['content-disposition'] || '')) return { plain: '', html: '' }
  if (/^text\/html/i.test(ctype)) return { plain: '', html: decodeBody(body, enc, charset) }
  if (/^text\/plain/i.test(ctype) || !/^[a-z]+\//i.test(ctype)) return { plain: decodeBody(body, enc, charset), html: '' }
  if (/^message\/rfc822/i.test(ctype) && depth < 6) return walk(body, depth + 1)
  return { plain: '', html: '' }
}

export function parseMail(raw: string): ParsedMail {
  const { head } = splitHeadBody(raw)
  const h = parseHeaders(head)
  const part = walk(raw)
  const text = (part.plain || htmlToText(part.html)).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return {
    headers: h,
    from: decodeWords(h['from'] || ''),
    to: decodeWords(h['to'] || ''),
    subject: decodeWords(h['subject'] || ''),
    messageId: (h['message-id'] || '').trim(),
    inReplyTo: (h['in-reply-to'] || '').trim(),
    references: (h['references'] || '').trim(),
    date: h['date'] || '',
    listId: h['list-id'] || '',
    listUnsubscribe: h['list-unsubscribe'] || '',
    autoSubmitted: h['auto-submitted'] || '',
    precedence: h['precedence'] || '',
    text,
  }
}

/** A readable preview: quoted replies and signatures trimmed. */
export function previewText(text: string, max = 500) {
  const lines = String(text || '').split('\n')
  const cut = lines.findIndex(l => /^(?:>|On .{6,80} wrote:$|-{2,}\s*$|_{5,}|From: .+|Sent from my )/.test(l.trim()))
  return (cut > 0 ? lines.slice(0, cut) : lines).join(' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** Gmail's forwarding confirmation: "(#123456789) Gmail Forwarding Confirmation - Receive Mail from x@gmail.com". */
export function gmailForwardingConfirmation(mail: Pick<ParsedMail, 'from' | 'subject' | 'text'>) {
  if (!/forwarding-noreply@google\.com/i.test(mail.from)) return null
  if (!/forwarding confirmation/i.test(mail.subject)) return null
  const code = mail.subject.match(/\(#(\d{6,12})\)/)?.[1] || mail.text.match(/confirmation code:?\s*(\d{6,12})/i)?.[1] || null
  const forwarder = mail.subject.match(/receive mail from\s+([^\s]+@[^\s]+)/i)?.[1] || mail.text.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}) has requested/i)?.[1] || null
  const link = mail.text.match(/https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s<>"]+/i)?.[0] || null
  // Gmail now often sends only a confirmation link (23 Oct live), older mails carry a numeric code.
  return code || link ? { code, forwarder, link } : null
}
