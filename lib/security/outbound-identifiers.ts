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
  let out = String(text ?? '')
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
  return out
}
