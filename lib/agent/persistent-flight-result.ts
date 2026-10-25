import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentActor } from './actor'

type Data = Record<string, unknown>
const object = (value: unknown): Data => value && typeof value === 'object' && !Array.isArray(value) ? value as Data : {}
const time = (value: unknown) => typeof value === 'string' ? Date.parse(value) : NaN
const clock = /^(?:[1-9]|1[0-2]):[0-5]\d [AP]M$/
const arrivalClock = /^(?:[1-9]|1[0-2]):[0-5]\d [AP]M(?: [\p{L}\p{N}, -]{1,70})?$/u
const carrier = /^[\p{L}\p{N} &'().+-]{1,120}$/u

/** Presentation of a persisted read receipt only. Never execute tools or trust its prose. */
function flightResult(row: Data, actor: AgentActor, runId: string): string | null {
  const output=object(row.output_json), runtime=object(output.runtime), context=object(output.context)
  const owner=String(actor.legacyTelegramId)
  if (String(row.telegram_id) !== owner || row.run_id !== runId || row.status !== 'completed' || row.tool_name !== 'travel.read'
    || output.source !== 'google-flights-browser' || output.verificationScope !== 'flight_search_rows'
    || output.ownerId !== owner || output.parentRunId !== runId || output.stepId !== row.id
    || !Number.isInteger(row.ordinal) || Number(row.ordinal)<1 || Number(row.ordinal)>10
    || runtime.stepKey !== `step-${row.ordinal}-travel` || !Number.isSafeInteger(runtime.attempt) || Number(runtime.attempt)<1 || output.attempt !== runtime.attempt
    || output.boundedObservation !== true || output.bookingCompleted !== false || output.verifiedProviderOutcome !== false || output.untrustedContent !== true
    || output.reconciliation_required === true || runtime.mutation !== false || runtime.verificationRequired !== true
    || runtime.requiresApproval !== false || !Number.isFinite(time(runtime.verifiedAt)) || time(runtime.verifiedAt) !== time(row.completed_at)
    || time(runtime.verifiedAt) > Date.now()+60_000 || !Number.isFinite(time(output.observedAt)) || time(output.observedAt) > time(runtime.verifiedAt) || time(output.observedAt) > Date.now()+60_000) return null
  const from=object(context.origin).code, to=object(context.destination).code
  const date=context.startDate, adults=context.adults, cabin=context.cabin
  if (context.kind !== 'flight' || context.roundTrip === true || context.returnDate
    || typeof from !== 'string' || !/^[A-Z]{3}$/.test(from) || typeof to !== 'string' || !/^[A-Z]{3}$/.test(to) || from === to
    || typeof date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(time(date)) || new Date(date).toISOString().slice(0,10) !== date
    || !Number.isInteger(adults) || Number(adults)<1 || Number(adults)>9
    || typeof cabin !== 'string' || !['economy','premium_economy','business','first'].includes(cabin)
    || !Array.isArray(output.options) || !output.options.length || output.options.length>6) return null
  const rows: string[]=[]
  for (const raw of output.options) {
    const option=object(raw)
    if (typeof option.airline !== 'string' || !carrier.test(option.airline) || typeof option.departure !== 'string' || !clock.test(option.departure)
      || typeof option.arrival !== 'string' || !arrivalClock.test(option.arrival) || !Number.isSafeInteger(option.fareInr) || Number(option.fareInr)<=0
      || !Number.isInteger(option.stops) || Number(option.stops)<0 || Number(option.stops)>4 || context.nonStop === true && option.stops !== 0
      || option.fareBasis !== 'party_total' || option.farePassengers !== adults || option.route !== `${from} → ${to}`) return null
    rows.push(`${rows.length+1}. INR ${Number(option.fareInr).toLocaleString('en-IN')} total · ${redactSecretShapedText(option.airline)} · ${option.departure} → ${option.arrival} · ${option.stops === 0 ? 'non-stop' : `${option.stops} stop(s)`}`)
  }
  let observed: string
  try {
    const formatter=new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:actor.timezone || 'Asia/Kolkata'})
    observed=`${formatter.format(new Date(String(output.observedAt)))} (${formatter.resolvedOptions().timeZone})`
  }
  catch { observed=new Date(String(output.observedAt)).toISOString() }
  const query=`Flights from ${from} to ${to} on ${date} one way for ${adults} adult${adults === 1 ? '' : 's'} in ${cabin.replace(/_/g,' ')}${context.nonStop === true ? ' non-stop' : ''}`
  const link=`https://www.google.com/travel/flights?hl=en&gl=in&curr=INR&q=${encodeURIComponent(query)}`
  return [`Flight options · ${from} → ${to} · ${date}`,`${adults} adult${adults === 1 ? '' : 's'} · ${cabin.replace(/_/g,' ')} · one-way`,...rows,
    `Observed ${observed}; fares may change. Baggage and optional charges are extra. No flight was booked.`,link].join('\n')
}

export async function readPersistentFlightResult(actor: AgentActor, runId: string): Promise<string | null> {
  const owner=String(actor.legacyTelegramId)
  const parent=async () => {
    const {data,error}=await supabaseAdmin.from('agent_runs').select('status,error,metadata_json').eq('id',runId).eq('telegram_id',owner).maybeSingle()
    return !error && data?.status === 'completed' && !data.error && data.metadata_json?.persistent_general_plan === true
  }
  try {
    if (!await parent()) return null
    const {data,error}=await supabaseAdmin.from('agent_steps').select('id,telegram_id,run_id,ordinal,tool_name,status,output_json,completed_at')
      .eq('run_id',runId).eq('telegram_id',owner).eq('tool_name','travel.read').eq('status','completed').order('ordinal',{ascending:true}).limit(11)
    if (error || !Array.isArray(data) || !data.length || data.length>10) return null
    const results=data.map(row=>flightResult(row as Data,actor,runId))
    if (results.some(result=>result === null) || !await parent()) return null
    const shown: string[]=[]
    for (const result of results) {
      if (shown.length === 3 || [...shown,result].join('\n\n').length>2800) break
      shown.push(result!)
    }
    if (!shown.length) return null
    return `${shown.join('\n\n')}${shown.length<results.length ? '\n\nMore completed flight searches are in this task’s details.' : ''}`
  } catch { return null }
}
