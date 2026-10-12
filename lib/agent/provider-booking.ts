// Provider booking (venues, salons, clinics): Gogo opens the provider page, picks the slot the
// person approved, logs in with their mobile number, asks for the OTP on WhatsApp, and stops on
// the payment page with a link to that same browser so the person pays themselves.
// Pure helpers only: no I/O, so the rules are testable.
//
// Rules that never bend:
//  - Gogo never presses Pay and never enters card, UPI or bank details.
//  - The OTP is caught before any model or handler, never stored or logged, and reaches the
//    browser only as a command-scoped environment variable.
//  - The mobile number reaches the browser the same way, so it never enters a model prompt.

export type BookingStage = 'otp' | 'payment' | 'review'

/** The 10-digit Indian mobile number from a WhatsApp id ("+91 98765 43210", "919876543210"). */
export function indianMobileFromWhatsApp(id: string | null | undefined): string | null {
  const digits = String(id || '').replace(/\D/g, '')
  if (/^91[6-9]\d{9}$/.test(digits)) return digits.slice(2)
  if (/^[6-9]\d{9}$/.test(digits)) return digits
  return null
}

/** "ending 3210": enough for the person to recognise their number, nothing more. */
export function maskMobile(mobile: string | null | undefined): string {
  const digits = String(mobile || '').replace(/\D/g, '')
  return digits.length >= 4 ? `ending ${digits.slice(-4)}` : 'on file'
}

/** A WhatsApp reply that is only a one-time code: 4 to 8 digits, spaces allowed ("482 913"). */
export function otpReply(text: string | null | undefined): string | null {
  const raw = String(text || '').trim()
  if (raw.length > 24) return null
  const m = raw.match(/^(?:(?:otp|code|the code is|code is|otp is)\s*[:\-]?\s*)?([0-9][0-9\s-]{2,14}[0-9])\.?$/i)
  if (!m) return null
  const digits = m[1].replace(/[\s-]/g, '')
  return /^\d{4,8}$/.test(digits) ? digits : null
}

const PAYMENT_HOSTS = /(?:^|\.)(?:razorpay\.com|juspay\.in|payu\.in|payumoney\.com|cashfree\.com|paytm\.(?:com|in)|phonepe\.com|billdesk\.com|ccavenue\.com|stripe\.com|checkout\.com|easebuzz\.in)$/i
const PAYMENT_COPY = /\b(?:proceed to pay|pay now|pay securely|make payment|complete payment|pay\s*(?:₹|rs\.?|inr)\s*\d|payment options|payment methods?|choose (?:a |your )?payment|select (?:a |your )?payment|upi id|enter upi|card number|net ?banking|saved cards)\b/i

/** True when the page is asking for payment: the point where Gogo hands over. */
export function bookingAtPayment(page: { url?: string; text?: string; title?: string; controls?: Array<{ label?: string }> } | null | undefined): boolean {
  if (!page) return false
  try { if (PAYMENT_HOSTS.test(new URL(String(page.url || '')).hostname)) return true } catch {}
  const labels = (page.controls || []).map(c => String(c?.label || '')).join('\n')
  return PAYMENT_COPY.test(`${page.title || ''}\n${String(page.text || '').slice(0, 20000)}\n${labels}`)
}

/**
 * True when the page shows an OTP was SENT and is waiting for it. Copy like "we'll send a
 * verification code" next to an empty mobile field is not enough: Gogo fills the number first.
 */
export function bookingOtpPrompt(page: { text?: string; title?: string; forms?: Array<{ inputs?: Array<{ name?: string; type?: string; label?: string }> }> } | null | undefined): boolean {
  if (!page) return false
  const text = `${page.title || ''}\n${String(page.text || '').slice(0, 20000)}`.replace(/\s+/g, ' ')
  const sent = /\b(?:enter|type|input)\s+(?:the\s+)?(?:\d\s*-?\s*digit\s+)?(?:otp|one[- ]time (?:password|code)|verification code|code)\b|\b(?:otp|code)\s+(?:has been\s+|was\s+)?sent\b|\bsent\s+(?:an?\s+|the\s+)?(?:\d\s*-?\s*digit\s+)?(?:otp|code|one[- ]time)\b|\bresend\s+(?:the\s+)?(?:otp|code)\b|\bverify\s+(?:the\s+)?otp\b|\bdidn'?t (?:get|receive) (?:the |an? )?(?:otp|code)\b/i.test(text)
  const field = (page.forms || []).flatMap(f => f.inputs || []).some(i => /\b(?:otp|one[- ]?time|verification code|passcode)\b/i.test(`${i?.name || ''} ${i?.label || ''}`))
  return sent || field
}

/** A click on a control that would pay or place the order. Gogo never presses these. */
export function bookingPaymentControlText(text: string): boolean {
  return /\b(?:pay|payment|place order|buy now|complete purchase)\b/i.test(String(text || ''))
}

export function bookingObjective(params: { date: string; time: string; timezone: string; service?: string; title?: string; location?: string; name?: string; email?: string; confirmation: string }) {
  const what = [params.service, params.title ? `at ${params.title}` : ''].filter(Boolean).join(' ')
  const who = [params.name ? `full name ${params.name}` : '', params.email ? `email ${params.email}` : ''].filter(Boolean).join(' and ')
  return `Provider booking up to payment${what ? ` for ${what}` : ''}: on this provider page${params.location ? ` (if it lists several venues, open one in ${params.location} that has this slot free)` : ''} choose exactly ${params.date} at ${params.time} (${params.timezone}), select that slot, and continue (Book, Proceed, Continue or Add to cart) until the booking summary or cart is shown. On a venue page press Book Now. If the booking page has sport, date and start-time selectors, set the sport (from the service), the date and the start time to match, then add one court to the cart and open the cart. If the site asks to log in or register, use fill_phone for the mobile number field and press the control that sends the OTP${who ? `; if it asks for more details use ${who}` : ''}. Stop on the payment step: never pay, never enter card, UPI or bank details. The person's confirmation: ${params.confirmation}`
}

export function bookingOtpMessage(params: { host: string; mobile: string | null; takeoverUrl: string; rejected?: boolean; channel?: 'sms' | 'email' }) {
  const email = params.channel === 'email'
  const lead = params.rejected
    ? `${params.host} did not accept that code. Send the new code from your ${email ? 'email' : 'SMS'} (tap "Resend" there first if it expired).`
    : email
      ? `I'm logging in to ${params.host} first. It sent a login code (OTP) to your email; check your inbox (and spam).`
      : `I'm logging in to ${params.host} with your number ${maskMobile(params.mobile)} first. It sent a login code (OTP) by SMS.`
  return `${lead}\n\nReply here with just the code, for example *482913*. I'll type it in and continue. I don't save the code anywhere.\n\nPrefer to type it yourself? Open this, tap Take control, enter it, then tap Resume:\n${params.takeoverUrl}`
}

export function bookingPaymentMessage(params: { host: string; summary?: string; takeoverUrl: string }) {
  return `Your booking on ${params.host} is ready for payment. I stopped before paying.\n\nPay here (it's the same browser I used, with your slot already selected):\n${params.takeoverUrl}\n\nTap *Take control*, check the date, time and amount, then pay with UPI or card. I never enter payment details or press Pay. The booking is only confirmed once you've paid and ${params.host} shows its confirmation.`
}

/** The site's own robot check (reCAPTCHA and similar) failed or is asking for a person. Gogo never
 * solves or gets around these: it presses the site's own Retry once, then hands over. */
export function bookingRobotCheck(text: string | null | undefined): boolean {
  return /\b(?:re-?captcha|captcha)\b[^.\n]{0,40}\b(?:fail|failed|error|expired|verify|verification)|\bverify (?:that )?you(?:'re| are) (?:a )?human\b|\bi'?m not a robot\b|\bunusual traffic\b/i.test(String(text || '').slice(0, 6000))
}

export function bookingReviewMessage(params: { host: string; summary?: string; takeoverUrl: string; robotCheck?: boolean }) {
  if (params.robotCheck) return `${params.host}'s robot check ("are you human") stopped the login, so it didn't send the code. I don't get around these checks myself.\n\nOpen this, tap *Take control*, tap Send OTP (and finish the check if it shows one), then tap *Resume*. I'll ask you for the code and carry on:\n${params.takeoverUrl}`
  return `I got as far as I safely could on ${params.host}, but didn't reach the payment step, so nothing is booked yet.\n\nOpen this, tap *Take control* and finish from where I stopped:\n${params.takeoverUrl}`
}

export type BookingTarget = { date?: string; time?: string; service?: string }

/** The date, time and service an approved booking objective asks for (from bookingObjective). */
export function bookingTargetFromObjective(objective: string | null | undefined): BookingTarget {
  const text = String(objective || '')
  const when = text.match(/choose exactly (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2}\s*[AP]M)/i)
  const what = text.match(/^Provider booking up to payment for (.+?)(?: at [^:]+)?:/i)
  return {
    ...(when ? { date: when[1], time: when[2].toUpperCase().replace(/\s+/, ' ') } : {}),
    ...(what && what[1] ? { service: what[1].trim() } : {}),
  }
}

const norm = (s: string) => String(s || '').toLowerCase().replace(/\b0+(\d)/g, '$1').replace(/[^a-z0-9]+/g, ' ').trim()

/**
 * Before Gogo presses Add to cart, Book, Proceed or Continue on a page with pickers, the pickers
 * must show the requested sport, date and time. 11 Oct 18:30: the planner set the date and time,
 * left the sport on Swimming and went for Add to Cart. Returns the fields that do not match.
 */
export function bookingSelectionMismatch(controls: Array<{ field?: string; label?: string }> | null | undefined, target: BookingTarget): string[] {
  const pickers = (controls || []).filter(c => c && c.field)
  const value = (re: RegExp) => pickers.find(c => re.test(String(c.field)))
  const out: string[] = []
  const date = value(/\bdate\b|\bday\b/i)
  if (target.date && date && !norm(String(date.label)).includes(norm(target.date))) out.push('date')
  const time = value(/\btime\b|\bslot\b/i)
  if (target.time && time && !norm(String(time.label)).includes(norm(target.time))) out.push('time')
  const sport = value(/\bsports?\b|\bactivity\b|\bservice\b|\bgame\b/i)
  const words = norm(target.service || '').split(' ').filter(w => w.length > 3 && !/^(court|courts|slot|slots|booking|venue|session)$/.test(w))
  if (words.length && sport && !words.some(w => norm(String(sport.label)).includes(w))) out.push('sport')
  return out
}

/** A control that moves a booking forward (adds to cart, books, proceeds). */
export function bookingAdvanceControlText(text: string): boolean {
  return /\b(?:add\s+to\s+cart|book\s+now|book|proceed|continue|checkout|check\s*out|confirm|reserve)\b/i.test(String(text || ''))
}
