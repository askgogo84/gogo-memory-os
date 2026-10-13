// Live slot check (12 Oct, modelled on Instinct): after a sports-venue search, Gogo opens the top
// venues on the booking site in its cloud browser, sets the sport, date and start time, reads which
// courts are offered and at what price, and reports them. Read-only: no login, no cart, nothing
// booked. Booking is a separate, approved step.
import { evaluateAgentExecutionPolicy } from './policy'
import { runSecureBrowser } from './secure-computer'
import { bookingObjective } from './provider-booking'

export type LiveSlotRequest = { listUrl: string; date: string; time: string; timezone: string; service: string; location: string }
export type VenueSlots = { venue: string; options: string[]; none: boolean; reason?: string; checked: boolean }

const ORDINAL = ['first', 'second', 'third']

export function liveSlotObjective(req: LiveSlotRequest, nth: number, skip: string[] = []) {
  // The booking objective carries the date/time/service the worker parses; drop its cart, login and
  // payment steps so the planner never sees "book" and "check only" at once (12 Oct: it refused twice).
  const base = bookingObjective({ date: req.date, time: req.time, timezone: req.timezone, service: req.service, location: req.location, confirmation: 'check live availability only' })
    .replace(/, and continue \(Book, Proceed, Continue or Add to cart\) until the booking summary or cart is shown\./, '.')
    .replace(/, then add one court to the cart and open the cart\./, '.')
    .replace(/ If the site asks to log in or register[^.]*\./, '')
    .replace(/ Stop on the payment step: never pay, never enter card, UPI or bank details\./, '')
  const avoid = skip.filter(Boolean).length ? ` Do not open ${skip.filter(Boolean).join(' or ')}; pick a different venue.` : ''
  return base + ` LIVE SLOT CHECK ONLY (read-only): on the list page open the ${ORDINAL[nth] || 'first'} bookable venue listed in ${req.location || 'the area'} (skip ads and venues elsewhere).${avoid} Press Book Now, and set the sport, date and start time with choose. Gogo reads the courts itself. Never log in, never add to a cart, never proceed or pay.`
}

/** One venue: the nth bookable venue on the list page. */
export async function checkVenueSlots(params: { userId: string; runId: string; req: LiveSlotRequest; nth: number; skip?: string[] }): Promise<VenueSlots> {
  const result = await runSecureBrowser({
    userId: `${params.userId}:slots:${params.nth}`, runId: `${params.runId}-v${params.nth + 1}`, url: params.req.listUrl,
    objective: liveSlotObjective(params.req, params.nth, params.skip || []), mode: 'execute',
    providerBooking: true, rehearsal: true, slotCheck: true, bookingPhone: null, bookingOtp: null, reserveHumanHandoff: false,
  })
  const slots = result.slots
  if (!slots) return { venue: String(result.title || '').replace(/^Check Real-Time Slots Availability at\s+/i, '').replace(/\s+on\s+Playo$/i, '').slice(0, 120) || 'a venue', options: [], none: false, checked: false }
  return { venue: slots.venue, options: slots.options || [], none: Boolean(slots.none), reason: slots.reason, checked: true }
}

/** The top venues, in parallel (one cloud browser each), within one function run. */
export async function runLiveSlotCheck(params: { userId: string; runId: string; req: LiveSlotRequest; venues?: number }) {
  // Same gate as any execute-mode browser task; this one never commits anything.
  const policy = evaluateAgentExecutionPolicy({ capability: 'browser', permissionLevel: 'ask', mode: 'execute', risk: 'low', irreversible: false, approvalStatus: 'approved' })
  if (!policy.allowed) throw new Error('live_slots_policy_blocked')
  const count = Math.max(1, Math.min(3, params.venues || 2))
  // One after another, so each later check is told which venues are already covered
  // (12 Oct: two parallel checks both opened the first venue).
  const venues: VenueSlots[] = []
  for (let nth = 0; nth < count; nth++) {
    const skip = venues.filter(v => v.checked).map(v => v.venue.split(',')[0].trim())
    const v = await checkVenueSlots({ ...params, nth, skip }).catch(() => null)
    if (v && !venues.some(x => x.checked && x.venue === v.venue)) venues.push(v)
  }
  return venues
}

function pretty(date: string) {
  const d = new Date(`${date}T12:00:00Z`)
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** WhatsApp text: exact courts and prices per venue, and what could not be checked. */
export function liveSlotMessage(req: LiveSlotRequest, venues: VenueSlots[]) {
  const when = `${pretty(req.date)}, ${req.time}`
  const lines: string[] = []
  venues.forEach((v, i) => {
    if (!v.checked) { lines.push(`${i + 1}. ${v.venue}: I couldn't read the slots there.`); return }
    if (v.none || !v.options.length) { lines.push(`${i + 1}. ${v.venue}: nothing free at ${req.time}${v.reason === 'time_not_offered' ? ' (that start time isn\'t offered)' : ''}.`); return }
    const { courts, shared } = slotItems(v.options)
    if (!courts.length) { lines.push(`${i + 1}. ${v.venue}: nothing free at ${req.time}.`); return }
    lines.push(`${i + 1}. ${v.venue}: ${courts.length} open: ${courts.join(', ')}${shared ? ` (${shared}${courts.length > 1 ? ' each' : ''})` : ''}`)
  })
  const bookable = venues.find(v => v.checked && !v.none && v.options.length)
  const tail = bookable
    ? `Checked live on the booking site just now; slots can go quickly and checkout fees aren't included. To book, reply for example *book the ${req.time.replace(/:00\s*/, ' ').toLowerCase()} slot at ${bookable.venue.split(/[,-]/)[0].trim()} on ${new Date(`${req.date}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}*. I'll log in with your number first (one OTP), then add a court to the cart and send you the payment link.`
    : `Nothing I could verify is free at that time. Want me to check another time or more venues?`
  return `Live slots · ${when}\n\n${lines.join('\n')}\n\n${tail}`
}

/** Picker entries → courts, with a price shown on its own line (12 Oct: "INR 450") applied to the courts. */
export function slotItems(options: string[]) {
  const price = (o: string) => o.replace(/\s*(?:INR|Rs\.?|₹)\s*(\d+(?:\.\d+)?)/i, ' (₹$1)').trim()
  const priceOnly = options.filter(o => /^\s*(?:INR|Rs\.?|₹)\s*\d+(?:\.\d+)?\s*$/i.test(o))
  const courts = options.filter(o => !priceOnly.includes(o)).map(price)
  const distinct = [...new Set(priceOnly.map(o => price(o).replace(/[()]/g, '')))]
  return { courts, shared: distinct.length === 1 ? distinct[0] : '' }
}
