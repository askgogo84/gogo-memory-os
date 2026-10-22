import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { evaluateAgentExecutionPolicy, type AgentPermissionLevel } from './policy'
import { buildTravelResearchContext, flightDateIssue, flightSearchPreferences } from './travel-research'
import { googleFlightOptionsFromEvidence, oneWayDisplayOrder, oneWaySearchLink, runLiveFlightBrowserTask } from './travel-browser-task'
import type { GeneralPlanStep } from './general-planner'
import type { AutonomousToolContext, AutonomousToolResult } from './autonomous-runtime'

const blocked = (reason: string): AutonomousToolResult => ({status:'blocked',error:`persistent_travel_${reason}`})
const retry = (reason: string): AutonomousToolResult => ({status:'retryable_failure',error:`persistent_travel_${reason}`})
const clean = (value: string, max: number) => redactSecretShapedText(value.replace(/\s+/g,' ').trim().slice(0,max))

export function persistentTravelFailureReply(error: unknown): string | null {
  const replies: Record<string,string> = {
    unsupported_request:'For this multi-step flight search, use “Find flights from BLR to DEL on YYYY-MM-DD for 1 adult in economy”. I haven’t searched or booked another itinerary.',
    invalid_date:'That departure date is invalid or in the past. Give a future date in YYYY-MM-DD format.',
    permission_off:'Travel or browser reading is off in your saved permissions. Enable both before trying this search again.',
    permission_invalid:'I could not verify your travel and browser permissions. No search was started.',
    permission_unavailable:'I could not check your travel and browser permissions. No search was started.',
    human_auth_required:'The flight site needs your attention. Open the browser and complete its check, then retry the search. No flight was booked.',
    provider_blocked:'The flight site blocked this read. No flight options or booking were verified.',
    read_unavailable:'The flight search stayed unavailable after bounded retries. No flight was booked. Try the search again or check the flight site directly.',
    read_budget_expired:'The flight read could not finish within its task budget. No flight was booked. Try the search again.',
    parent_read_failed:'I could not confirm this task’s current state. Check its details before trying the flight search again.',
    evidence_unverified:'I couldn’t verify matching flight rows and their total fare. No flight was booked. Try the search again or check the flight site directly.',
  }
  const code=String(error || '')
  const reason=code.replace(/^persistent_travel_/,'')
  return code.startsWith('persistent_travel_') && Object.prototype.hasOwnProperty.call(replies,reason) ? replies[reason] : null
}

/** Read-only adapter: existing browser/session authority, no nested travel run or generic executor. */
/** The planner writes the step; the person wrote the mission. A constraint the person gave that this bounded
 *  one-way adult grammar cannot carry (child, return, budget, time window, baggage) or a different date or adult
 *  count blocks the step instead of searching something else (release review, 22 Oct). Pure. */
export function missionContradictsTravelStep(missionText: string, step: {startDate?: string; adults?: number}): boolean {
  const m=String(missionText||'').toLowerCase()
  if (!m.trim()) return false
  if (/\b(?:child|children|kid|kids|infant|baby|toddler|return(?:ing)?|round[- ]?trip|coming back|back on|budget|under\s*(?:₹|rs\.?|inr)|below\s*(?:₹|rs\.?|inr)|baggage|luggage|check[- ]?in bag|(?:morning|afternoon|evening|night|red[- ]?eye)\s+flights?|depart(?:ing|ure)?\s+(?:before|after))\b/.test(m)) return true
  const people=m.match(/\b([2-9]|two|three|four|five|six|seven|eight|nine)\s+(?:adults?|people|persons|passengers|travell?ers|of us)\b/)
  const words:Record<string,number>={two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9}
  if (people && (Number(people[1])||words[people[1]]) !== (step.adults||1)) return true
  const asked=buildTravelResearchContext(missionText).startDate
  if (asked && step.startDate && asked !== step.startDate) return true
  return false
}

export async function executePersistentTravelRead(context: AutonomousToolContext, step: GeneralPlanStep, missionText = ''): Promise<AutonomousToolResult> {
  const input=String(step.instruction || '').replace(/\s+/g,' ').trim()
  // Deliberately bounded grammar: do not silently discard a return, child, budget,
  // baggage, time-window, booking instruction or a second objective.
  const request=input.match(/^(?:please )?(?:find|search|check|show|compare) (?:(?:non-?stop|direct|one[- ]way) )?flights from ([a-z .'-]{3,40}) to ([a-z .'-]{3,40}) on (20\d{2}-\d{2}-\d{2})(?: for ([1-9]|one|two|three|four|five|six|seven|eight|nine) adults?)?(?: in (economy|premium[- ]economy|business|first(?: class)?))?[.!]?$/i)
  if (!request) return blocked('unsupported_request')
  const travel=buildTravelResearchContext(input)
  const preferences=flightSearchPreferences(input)
  if (flightDateIssue(input,travel)) return blocked('invalid_date')
  if (!travel.origin?.code || !travel.destination?.code || travel.origin.code === travel.destination.code || travel.startDate !== request[3] || travel.endDate && travel.endDate !== travel.startDate) return blocked('unsupported_request')
  const search={...travel,...preferences}
  if (missionContradictsTravelStep(missionText,{startDate:search.startDate,adults:(search as any).adults})) return blocked('unsupported_request')
  const ownerId=String(context.actor.legacyTelegramId)
  for (const capability of ['travel','browser'] as const) {
    const permission=await supabaseAdmin.from('agent_permissions').select('level').eq('telegram_id',ownerId).eq('capability',capability).maybeSingle()
    if (permission.error) return blocked('permission_unavailable')
    const level=permission.data?.level ?? 'ask'
    if (!['off','read','draft','ask','auto'].includes(level)) return blocked('permission_invalid')
    if (!evaluateAgentExecutionPolicy({capability,permissionLevel:level as AgentPermissionLevel,mode:'read',risk:'low',irreversible:false}).allowed) return blocked('permission_off')
  }
  const parentLive=async () => {
    const result=await supabaseAdmin.from('agent_runs').select('status,error').eq('id',context.runId).eq('telegram_id',ownerId).maybeSingle()
    return result.error ? 'unavailable' : result.data && ['queued','running','waiting_approval','paused'].includes(result.data.status) && result.data.error !== 'user_cancelled' ? 'live' : 'terminal'
  }
  const before=await parentLive()
  if (before !== 'live') return before === 'unavailable' ? retry('parent_read_failed') : blocked('parent_terminal')
  const lease=Date.parse(context.runtime.leaseUntil || '')
  const deadline=Math.min(Date.now()+90_000,lease)
  if (!Number.isFinite(deadline) || deadline <= Date.now()+45_000) return retry('read_budget_expired')
  try {
    const result=await runLiveFlightBrowserTask({actor:context.actor,context:search,objective:input,runId:context.runId,observedOnly:true,deadline})
    const after=await parentLive()
    if (after !== 'live') return after === 'unavailable' ? retry('parent_read_failed') : blocked('parent_terminal')
    if (!result || result.status === 'failed') return retry('read_unavailable')
    const browser=result.browser
    if (result.status === 'blocked') return blocked(browser?.blockReason === 'human_auth_required' ? 'human_auth_required' : 'provider_blocked')
    if (!browser || browser.status !== 'completed' || !Array.isArray(browser.actions) || browser.actions.some(action=>action.consequential && action.status === 'done')) return blocked('evidence_unverified')
    const url=new URL(browser.url)
    if (!['https://google.com','https://www.google.com'].includes(url.origin) || url.username || url.password) return blocked('evidence_unverified')
    const evidence=browser.flightEvidence
    const controls=evidence?.searchControls
    const labels=evidence?.resultLabels
    if (!Array.isArray(controls) || controls.length > 40 || controls.some(label=>typeof label !== 'string' || label.length > 500)
      || !Array.isArray(labels) || labels.length > 80 || labels.some(label=>typeof label !== 'string' || label.length > 2000)
      || !controls.some(label=>new RegExp(`^${search.adults} passengers?\\b`,'i').test(label))
      || !controls.some(label=>/^Track prices from .+ to .+ departing \d{4}-\d{2}-\d{2}$/i.test(label) && label.endsWith(`departing ${search.startDate}`))) return blocked('evidence_unverified')
    for (const prefix of [/^Where from\?/i,/^Where to\?/i,/^Change ticket type\./i,/^Change seating class\./i,/^\d+ passengers?\b/i,/^Track prices from /i]) {
      if (controls.filter(label=>prefix.test(label)).length !== 1) return blocked('evidence_unverified')
    }
    const cabin=search.cabin.replace(/_/g,' ')
    if (!controls.some(label=>new RegExp(`^Change seating class\\.\\s*${cabin}\\.?$`,'i').test(label))) return blocked('evidence_unverified')
    // Re-derive from the observed labels. Never trust model options or a prose summary.
    // Controls supply the year; reject a contradictory explicit row year/weekday too.
    const date=new Date(`${search.startDate}T00:00:00Z`)
    const weekday=new Intl.DateTimeFormat('en',{weekday:'long',timeZone:'UTC'}).format(date)
    const month=new Intl.DateTimeFormat('en',{month:'long',timeZone:'UTC'}).format(date)
    const rowDate=new RegExp(` on ${weekday}, ${month} ${date.getUTCDate()}(?:,? ${date.getUTCFullYear()})? and arrives at `,'i')
    const clock=/^(?:[1-9]|1[0-2]):[0-5]\d [AP]M\b/i
    const observed=googleFlightOptionsFromEvidence(browser,search).filter(option=>option.fareBasis === 'party_total' && option.farePassengers === search.adults
      && rowDate.test(option.evidence) && clock.test(option.departure) && clock.test(option.arrival))
    if (!observed.length) return blocked('evidence_unverified')
    const options=oneWayDisplayOrder(observed).map(option=>({...option,airline:clean(option.airline,120),arrival:clean(option.arrival,120),
      ...(option.layover ? {layover:clean(option.layover,180)} : {}),evidence:clean(option.evidence,2000)}))
    const text=[`${search.routeLabel} · ${search.startDate} · ${search.adults} adult${search.adults === 1 ? '' : 's'} · ${search.cabin.replace(/_/g,' ')} · one-way`,
      ...options.map((option,index)=>`${index+1}. INR ${option.fareInr} total · ${option.airline} · ${option.departure} → ${option.arrival} · ${option.stops === 0 ? 'non-stop' : `${option.stops} stop(s)`}`),
      'Observed Google Flights rows; fares may change. Baggage and optional charges are extra. No flight was booked.',oneWaySearchLink(search)].join('\n')
    return {status:'completed',verified:true,output:{source:'google-flights-browser',verificationScope:'flight_search_rows',ownerId,parentRunId:context.runId,stepId:context.step.id,
      observedAt:new Date().toISOString(),attempt:context.runtime.attempt,readDeadline:new Date(deadline-30_000).toISOString(),
      bookingCompleted:false,verifiedProviderOutcome:false,untrustedContent:true,boundedObservation:true,context:search,options,text}}
  } catch {
    return retry('read_unavailable')
  }
}
