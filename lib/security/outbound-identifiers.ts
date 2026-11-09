// Outbound leak filter (Duet brief, 23 Oct): Gogo never sends a full payment-card, Aadhaar or PAN number in a
// message. Only checksum-valid card (Luhn) and Aadhaar (Verhoeff) numbers and PAN-shaped codes are masked, keeping
// the last four characters so the person can still tell which one is meant. Pure; no network.

function luhnValid(digits: string): boolean {
  let sum = 0, alt = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48
    if (alt) { n *= 2; if (n > 9) n -= 9 }
    sum += n; alt = !alt
  }
  return sum % 10 === 0
}

const D = [[0,1,2,3,4,5,6,7,8,9],[1,2,3,4,0,6,7,8,9,5],[2,3,4,0,1,7,8,9,5,6],[3,4,0,1,2,8,9,5,6,7],[4,0,1,2,3,9,5,6,7,8],[5,9,8,7,6,0,4,3,2,1],[6,5,9,8,7,1,0,4,3,2],[7,6,5,9,8,2,1,0,4,3],[8,7,6,5,9,3,2,1,0,4],[9,8,7,6,5,4,3,2,1,0]]
const P = [[0,1,2,3,4,5,6,7,8,9],[1,5,7,6,2,8,3,0,9,4],[5,8,0,3,7,9,6,1,4,2],[8,9,1,6,0,4,3,5,2,7],[9,4,5,3,1,2,6,8,7,0],[4,2,8,6,5,7,3,9,0,1],[2,7,9,3,8,0,6,4,1,5],[7,0,4,6,9,1,3,2,5,8]]
function verhoeffValid(digits: string): boolean {
  let c = 0
  const rev = digits.split('').reverse()
  for (let i = 0; i < rev.length; i++) c = D[c][P[i % 8][Number(rev[i])]]
  return c === 0
}

export function maskOutboundIdentifiers(text: string): string {
  let out = tidyLinks(String(text ?? ''))
  // Card: 13–19 digits, optionally grouped by spaces or dashes.
  out = out.replace(/(?<![\d])(?:\d[ -]?){12,18}\d(?![\d])/g, m => {
    const digits = m.replace(/\D/g, '')
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) return `card ending ${digits.slice(-4)}`
    return m
  })
  // Aadhaar: 12 digits (first 2–9), optionally 4-4-4.
  out = out.replace(/(?<![\d])[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![\d])/g, m => {
    const digits = m.replace(/\D/g, '')
    return digits.length === 12 && verhoeffValid(digits) ? `Aadhaar ending ${digits.slice(-4)}` : m
  })
  // PAN: AAAAA9999A, 4th letter is the holder type.
  out = out.replace(/\b[A-Z]{3}[ABCFGHLJPT][A-Z]\d{4}[A-Z]\b/g, m => `PAN ending ${m.slice(-4)}`)
  return brandSafe(out)
}

// 29 Oct live: "Please send a specific future date and time for Claude first" (an old test reminder named the
// model). The assistant is Gogo; the underlying model or vendor is never named to a user. Links and email addresses
// (claude.ai, anthropic.com) are left alone. Pure.
// Text between U+2063 markers is quoted from someone else (a shared post's title) and is sent as written; the markers
// are removed here, the last step before WhatsApp.
export function brandSafe(text: string): string {
  return String(text ?? '').split(/(\u2063[\s\S]*?\u2063)/).map(part => part.length > 1 && part.startsWith('\u2063') && part.endsWith('\u2063') ? part : brandSafeOutside(part)).join('').replace(/\u2063/g, '')
}
// 6 Nov live: a competitor summary listed "Muse, Hermes, Claude, ChatGPT…" and came out as "…Gogo…". When Claude is
// named beside other AI products, or as a product (Claude Duet, Claude Cowork, Claude Design), it is a product name.
const OTHER_AI = /\b(?:ChatGPT|GPT|OpenAI|Gemini|Perplexity|Copilot|Manus|Muse|Instinct|Wajo|Hermes|Grok|Mistral|Llama|DeepSeek|Dots)\b/i
const CLAUDE_PRODUCT = /\bClaude\s+(?:Duet|Cowork|Design|Desktop|Chrome|Max|Pro|Team|Enterprise)\b/
// 9 Nov (#1104): branding must never change what the owner approves or what a source says. An approval prompt is
// shown exactly as it will be executed (a contact may really be called Claude), double-quoted text is someone
// else's words, and "Anthropic" is renamed only where it names the assistant's maker ("made by Anthropic"), not in
// factual statements about the company.
const APPROVAL_PROMPT = /\bReply\s+\*?YES\b|\bPlease confirm\b|^\s*Approve\b/im
const QUOTED_SPAN = /("[^"\n]*"|“[^”\n]*”)/
const MAKER_PHRASE = /\b(made|built|created|developed|trained|powered)\s+by\s+Anthropic(?![\w@/-]|\.com\b)/gi
function brandSafeOutside(text: string): string {
  const s = String(text ?? '')
  if (APPROVAL_PROMPT.test(s) || CLAUDE_PRODUCT.test(s) || (OTHER_AI.test(s) && /\bClaude\b/.test(s))) return s
  return s.split(QUOTED_SPAN).map((part, i) => i % 2 ? part : part
    .replace(/(?<![\w./@-])(?:Anthropic['’]s\s+)?Claude(?:\s+(?:AI|Code|Opus|Sonnet|Haiku|Fable|Mythos)(?:\s+\d+(?:\.\d+)?)?)?(?:['’]s)?(?![\w@/-]|\.(?:ai|com)\b)/g, m => /['’]s$/.test(m) ? 'Gogo’s' : 'Gogo')
    .replace(MAKER_PHRASE, '$1 by our AI provider')).join('')
}


// 31 Oct live: salon results came as 300-character google.com/goto?url=… redirects. A link is sent as the page it
// points to, without tracking parameters, so it reads as an address. Pure.
const TRACKING = /^(?:utm_[a-z]+|gclid|fbclid|srsltid|ved|usg|sa|ei|igshid|igsh|si|ref|ref_src|ref_url|mc_cid|mc_eid|_hsenc|_hsmi|opi|sca_esv|rlz|oq|gs_lcrp|sourceid|ie)$/i
export function tidyUrl(raw: string): string {
  let url = raw
  for (let i = 0; i < 2; i++) {
    const m = url.match(/^https?:\/\/(?:www\.)?google\.[a-z.]+\/(?:goto|url)\?(.*)$/i)
    if (!m) break
    const params = new URLSearchParams(m[1])
    const target = [...params.getAll('url'), ...params.getAll('q'), ...params.getAll('u')].find(v => /^https?:\/\//i.test(v))
    if (!target || !/^https?:\/\//i.test(target)) break
    url = target
  }
  try {
    const u = new URL(url)
    for (const key of Array.from(u.searchParams.keys())) if (TRACKING.test(key)) u.searchParams.delete(key)
    let out = u.toString()
    if (!u.search) out = out.replace(/\?$/, '')
    return out.replace(/\/$/, '') === `${u.origin}` ? u.origin : out
  } catch { return url }
}
export function tidyLinks(text: string): string {
  return String(text ?? '').replace(/https?:\/\/[^\s<>)\]]+/g, m => {
    const trail = m.match(/[.,;!?]+$/)?.[0] || ''
    return tidyUrl(trail ? m.slice(0, -trail.length) : m) + trail
  })
}
