import { supabaseAdmin } from '@/lib/supabase-admin'
import { AIRLINES, checkInLink, checkInOpensHours, DEFAULT_CHECKIN_OPENS_HOURS } from '@/lib/services/airline-checkin'
import { registerLifeEvent } from './life-event-engine'

function safe(value: unknown, max = 500) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function airlineCode(flightNo: unknown) {
  const cleaned = safe(flightNo, 40).replace(/[^a-z0-9]/gi, '').toUpperCase()
  if (cleaned.length < 2) return null
  const code = cleaned.slice(0, 2)
  return code in AIRLINES ? code : null
}

function normalizedFlightNo(value: unknown) {
  return safe(value, 40).replace(/[^a-z0-9]/gi, '').toUpperCase()
}

function flightStatusUrl(flightNo: unknown) {
  const flight = normalizedFlightNo(flightNo)
  return flight ? `https://www.flightaware.com/live/flight/${encodeURIComponent(flight)}` : null
}

function checkinWindowHours(code: string | null) {
  try {
    return checkInOpensHours(code, false)
  } catch {
    return DEFAULT_CHECKIN_OPENS_HOURS
  }
}

function titleFor(row: any) {
  const carrier = safe(row.airline || '', 100)
  const flight = safe(row.flight_no || '', 60)
  const route = row.from_city && row.to_city ? `${safe(row.from_city, 100)} → ${safe(row.to_city, 100)}` : 'Flight'
  return [carrier, flight, route].filter(Boolean).join(' · ').slice(0, 240)
}

async function findExistingLifeEvent(row: any) {
  const ticketId = String(row.id)
  const base = () => supabaseAdmin.from('life_events')
    .select('id,metadata_json,source_refs,lifecycle_state')
    .eq('telegram_id', String(row.telegram_id))
    .eq('event_type', 'travel')
    .eq('subtype', 'flight')

  // Current DB trigger writes snake_case. Earlier bridge previews wrote camelCase.
  // Check both so adoption reuses the exact durable event instead of creating a
  // second set of check-in/reminder/watch actions for the same ticket.
  const snake = await base().contains('metadata_json', { travel_ticket_id: row.id }).limit(1).maybeSingle()
  if (snake.error) throw new Error(`flight_life_event_lookup_failed:${snake.error.message}`)
  if (snake.data?.id) return snake.data

  const camel = await base().contains('metadata_json', { travelTicketId: ticketId }).limit(1).maybeSingle()
  if (camel.error) throw new Error(`flight_life_event_lookup_failed:${camel.error.message}`)
  if (camel.data?.id) return camel.data
  return null
}

async function enrichExistingLifeEvent(event: any, row: any, enrichment: Record<string, unknown>) {
  const existingMeta = event?.metadata_json && typeof event.metadata_json === 'object' ? event.metadata_json : {}
  const existingRefs = Array.isArray(event?.source_refs) ? event.source_refs : []
  const ticketId = String(row.id)
  const hasTicketRef = existingRefs.some((ref: any) => String(ref?.id || '') === ticketId && String(ref?.kind || ref?.type || '') === 'travel_ticket')
  const nextRefs = hasTicketRef ? existingRefs : [...existingRefs, { kind: 'travel_ticket', id: ticketId, source: safe(row.source || 'saved', 80) }]

  // Never reset lifecycle_state, next_action_at or worker-owned action state here.
  // This cron may run every minute; enrichment must be monotonic and idempotent.
  const { error } = await supabaseAdmin.from('life_events').update({
    metadata_json: { ...existingMeta, ...enrichment, travel_ticket_id: row.id },
    source_refs: nextRefs,
    updated_at: new Date().toISOString(),
  }).eq('id', String(event.id)).eq('telegram_id', String(row.telegram_id))
  if (error) throw new Error(`flight_life_event_enrich_failed:${error.message}`)
}

async function ensureMissingFlightActions(eventId: string, row: any, checkinOpensAt: string, statusUrl: string | null) {
  const telegramId = String(row.telegram_id)
  const departAt = new Date(row.depart_at)
  const readinessAt = new Date(departAt.getTime() - 3 * 60 * 60_000).toISOString()
  const disruptionAt = new Date(departAt.getTime() - 24 * 60 * 60_000).toISOString()
  const rows = [
    {
      life_event_id:eventId, telegram_id:telegramId, action_key:'prepare-web-checkin', action_type:'browser_prepare', capability:'browser',
      title:'Prepare airline web check-in', due_at:checkinOpensAt, requires_approval:false, irreversible:false,
      payload_json:{ pnr:row.pnr || null, flight_no:row.flight_no || null, prepare_only:true },
    },
    {
      life_event_id:eventId, telegram_id:telegramId, action_key:'checkin-submit-approval', action_type:'approval', capability:'travel',
      title:'Ask before airline check-in is submitted', due_at:checkinOpensAt, requires_approval:true, irreversible:true,
      payload_json:{ approval_type:'booking', never_auto_submit:true },
    },
    {
      life_event_id:eventId, telegram_id:telegramId, action_key:'watch-boarding-pass-email', action_type:'email_watch', capability:'email',
      title:'Watch connected email for boarding pass or check-in confirmation', due_at:checkinOpensAt, requires_approval:false, irreversible:false,
      payload_json:{ read_only:true, pnr:row.pnr || null, flight_no:row.flight_no || null },
    },
    {
      life_event_id:eventId, telegram_id:telegramId, action_key:'departure-readiness', action_type:'notify', capability:'travel',
      title:'Prepare for departure', due_at:readinessAt, requires_approval:false, irreversible:false,
      payload_json:{ from:row.from_city || null, to:row.to_city || null },
    },
    {
      life_event_id:eventId, telegram_id:telegramId, action_key:'travel-disruption-watch', action_type:'monitor', capability:'travel',
      title:'Watch for meaningful flight changes', due_at:disruptionAt, requires_approval:false, irreversible:false,
      payload_json:{ notify_only_on_material_change:true, statusUrl, flight_no:row.flight_no || null },
    },
  ]

  // ignoreDuplicates is critical: completed/deferred/running action rows contain
  // worker state (fingerprints, retry counters, approval/run ids). Never overwrite it.
  const { error } = await supabaseAdmin.from('life_event_actions').upsert(rows, {
    onConflict:'life_event_id,action_key',
    ignoreDuplicates:true,
  })
  if (error) throw new Error(`flight_life_event_actions_enrich_failed:${error.message}`)
}

async function adoptOne(row: any) {
  const departAt = row.depart_at ? new Date(row.depart_at) : null
  if (!departAt || !Number.isFinite(departAt.getTime())) return null
  const code = airlineCode(row.flight_no)
  const windowHours = checkinWindowHours(code)
  const checkinOpensAt = new Date(departAt.getTime() - windowHours * 60 * 60_000).toISOString()
  const checkInUrl = checkInLink(code)
  const statusUrl = flightStatusUrl(row.flight_no)
  const enrichment = {
    legIndex:Number(row.leg_index || 0),
    airlineCode:code,
    flightNo:safe(row.flight_no || '', 80) || null,
    seat:safe(row.seat || '', 80) || null,
    checkinOpensAt,
    checkInUrl:checkInUrl || null,
    statusUrl,
    ticketSource:safe(row.source || '', 80) || null,
    autonomousSource:'travel_ticket_bridge',
  }

  let event = await findExistingLifeEvent(row)
  if (!event) {
    // Backfill only: installations predating the DB trigger may have travel_tickets
    // with no life event. New inserts are normally promoted by the trigger first.
    const registered = await registerLifeEvent({
      telegramId:row.telegram_id,
      eventType:'travel', subtype:'flight', source:`travel_ticket_${safe(row.source || 'saved', 40)}`,
      title:titleFor(row), provider:safe(row.airline || '',160) || null,
      startAt:row.depart_at, endAt:row.arrive_at || null,
      timezone:safe(row.depart_tz || 'Asia/Kolkata',100),
      location:row.from_city && row.to_city ? `${safe(row.from_city,100)} → ${safe(row.to_city,100)}` : safe(row.from_city || '',160) || null,
      confirmationRef:safe(row.pnr || row.booking_group || '',160) || null,
      participants:Array.isArray(row.passengers) ? row.passengers.map((x:unknown)=>safe(x,120)).filter(Boolean) : [],
      metadata:{ travelTicketId:String(row.id), travel_ticket_id:row.id, ...enrichment },
      sourceRefs:[{ type:'travel_ticket', id:String(row.id), source:safe(row.source || 'saved',80) }],
    })
    event = { id:registered.id, metadata_json:{}, source_refs:[] }
  } else {
    await enrichExistingLifeEvent(event, row, enrichment)
  }

  await ensureMissingFlightActions(String(event.id), row, checkinOpensAt, statusUrl)
  return String(event.id)
}

/**
 * Adopt every upcoming saved flight into the autonomous Life Event engine.
 * Pages through the full rolling window so a busy account/global table cannot
 * starve later flights behind the first batch. Existing events/actions are reused
 * and enriched without resetting worker-owned state.
 */
export async function syncUpcomingFlightTicketsToLifeEvents(maxRows = 1000) {
  const now = new Date()
  const lowerBound = new Date(now.getTime() - 6 * 60 * 60_000).toISOString()
  const upperBound = new Date(now.getTime() + 45 * 24 * 60 * 60_000).toISOString()
  const pageSize = 100
  const ceiling = Math.max(1, Math.min(2000, maxRows))
  let offset = 0
  let checked = 0
  let synced = 0
  let failed = 0
  const results: Array<{ ticketId:string; lifeEventId?:string; error?:string }> = []

  while (checked < ceiling) {
    const take = Math.min(pageSize, ceiling - checked)
    const { data, error } = await supabaseAdmin.from('travel_tickets')
      .select('id,telegram_id,type,booking_group,leg_index,from_city,to_city,depart_at,arrive_at,depart_tz,airline,flight_no,pnr,seat,passengers,source,raw')
      .eq('type','flight')
      .gte('depart_at',lowerBound)
      .lt('depart_at',upperBound)
      .order('depart_at',{ascending:true})
      .order('id',{ascending:true})
      .range(offset, offset + take - 1)

    if (error) {
      console.error('TRAVEL_LIFE_EVENT_BRIDGE_READ_FAILED:', error.message)
      return { checked, synced, failed, unavailable:true, results }
    }
    const batch = data || []
    if (!batch.length) break

    for (const row of batch) {
      checked++
      try {
        const lifeEventId = await adoptOne(row)
        if (lifeEventId) {
          synced++
          results.push({ ticketId:String(row.id), lifeEventId })
        }
      } catch (err:any) {
        failed++
        const message = safe(err?.message || err || 'unknown',300)
        console.error('TRAVEL_LIFE_EVENT_BRIDGE_SYNC_FAILED:', row?.id, message)
        results.push({ ticketId:String(row?.id || ''), error:message })
      }
    }

    offset += batch.length
    if (batch.length < take) break
  }

  return { checked, synced, failed, unavailable:false, results }
}
