// Booking rehearsal: walks the real Playo booking flow in Gogo's cloud browser with the real planner,
// on public pages only, and stops before Add To Cart. No account, no phone number, no cart change,
// no payment. Each step is logged (BOOKING_REHEARSAL_WAVE / BROWSER_BOOKING_STOP) so the flow can be
// fixed from the logs instead of from live WhatsApp tests (11 Oct: eight live tests in one day).
// Runs from a cron only until REHEARSAL_UNTIL, alternating planner models to compare them.
import { evaluateAgentExecutionPolicy } from './policy'
import { runSecureBrowser } from './secure-computer'
import { bookingObjective } from './provider-booking'
import { withPlannerModel } from './planner-provider'

export const REHEARSAL_UNTIL = Date.parse('2026-10-11T19:30:00Z') // 1 am IST, 12 Oct
export const REHEARSAL_MODELS = ['claude-haiku-4-5', 'claude-haiku-5-5'] as const
const START_URL = 'https://playo.co/venues/hsr-layout-bengaluru/sports/badminton'

function nextSaturdayIst(now = new Date()) {
  const ist = new Date(now.getTime() + 330 * 60_000)
  const delta = ((6 - ist.getUTCDay()) + 7) % 7 || 7
  const d = new Date(ist.getTime() + delta * 86_400_000)
  return d.toISOString().slice(0, 10)
}

export function rehearsalModelFor(now = new Date()) {
  return REHEARSAL_MODELS[Math.floor(now.getUTCMinutes() / 5) % REHEARSAL_MODELS.length]
}

export async function runBookingRehearsal(now = new Date()) {
  if (now.getTime() > REHEARSAL_UNTIL) return { skipped: 'rehearsal_window_closed' }
  // Same gate as any execute-mode browser task; the rehearsal is pre-approved and never commits.
  const policy = evaluateAgentExecutionPolicy({ capability: 'browser', permissionLevel: 'ask', mode: 'execute', risk: 'high', irreversible: false, approvalStatus: 'approved' })
  if (!policy.allowed) return { skipped: `policy_${policy.reason}` }
  const model = rehearsalModelFor(now)
  const date = nextSaturdayIst(now)
  const objective = bookingObjective({ date, time: '7:00 AM', timezone: 'Asia/Kolkata', service: 'badminton court', title: 'Badminton Venues in Hsr-layout-bengaluru', location: 'HSR Layout, Bengaluru', confirmation: 'book the 7 am slot at Machaxi Milan on Saturday' })
  const runId = `rehearsal-${now.toISOString().slice(0, 16)}`
  console.log('BOOKING_REHEARSAL_START:', JSON.stringify({ runId, model, date }))
  const started = Date.now()
  try {
    const result = await withPlannerModel(model, () => runSecureBrowser({
      userId: 'booking-rehearsal', runId, url: START_URL, objective, mode: 'execute',
      providerBooking: true, rehearsal: true, bookingPhone: null, bookingOtp: null, reserveHumanHandoff: false,
    }))
    const out = { runId, model, ms: Date.now() - started, status: result.status, stage: result.bookingStage || null, url: result.url, title: result.title, steps: result.actions.map(a => `${a.kind}:${a.status}`) }
    console.log('BOOKING_REHEARSAL_END:', JSON.stringify(out))
    return out
  } catch (err: any) {
    const out = { runId, model, ms: Date.now() - started, error: String(err?.message || err).slice(0, 200) }
    console.error('BOOKING_REHEARSAL_FAILED:', JSON.stringify(out))
    return out
  }
}
