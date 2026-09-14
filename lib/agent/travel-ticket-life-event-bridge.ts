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

/**
 * Adopt upcoming rows from the mature travel_tickets store into the autonomous
 * Life Event engine. registerLifeEvent is idempotent, so running this every cron
 * cycle safely backfills old tickets and keeps new PDF/image/text tickets wired
 * into check-in, email-watch, disruption-watch and readiness actions.
 */
export async function syncUpcomingFlightTicketsToLifeEvents(limit = 100) {
  const now = new Date()
  const lowerBound = new Date(now.getTime() - 6 * 60 * 60_000).toISOString()
  const upperBound = new Date(now.getTime() + 45 * 24 * 60 * 60_000).toISOString()

  const { data, error } = await supabaseAdmin.from('travel_tickets')
    .select('id,telegram_id,type,booking_group,leg_index,from_city,to_city,depart_at,arrive_at,depart_tz,airline,flight_no,pnr,seat,passengers,source,raw')
    .eq('type', 'flight')
    .gte('depart_at', lowerBound)
    .lt('depart_at', upperBound)
    .order('depart_at', { ascending: true })
    .limit(Math.max(1, Math.min(250, limit)))

  if (error) {
    // Older/code-first environments may not have travel_tickets yet. Keep the
    // lifecycle cron healthy instead of taking every background workflow down.
    console.error('TRAVEL_LIFE_EVENT_BRIDGE_READ_FAILED:', error.message)
    return { checked: 0, synced: 0, failed: 0, unavailable: true }
  }

  let synced = 0
  let failed = 0
  const results: Array<{ ticketId: string; lifeEventId?: string; error?: string }> = []

  for (const row of data || []) {
    try {
      const departAt = row.depart_at ? new Date(row.depart_at) : null
      if (!departAt || !Number.isFinite(departAt.getTime())) continue
      const code = airlineCode(row.flight_no)
      const windowHours = checkinWindowHours(code)
      const checkinOpensAt = new Date(departAt.getTime() - windowHours * 60 * 60_000).toISOString()
      const checkInUrl = checkInLink(code)

      const registered = await registerLifeEvent({
        telegramId: row.telegram_id,
        eventType: 'travel',
        subtype: 'flight',
        source: `travel_ticket_${safe(row.source || 'saved', 40)}`,
        title: titleFor(row),
        provider: safe(row.airline || '', 160) || null,
        startAt: row.depart_at,
        endAt: row.arrive_at || null,
        timezone: safe(row.depart_tz || 'Asia/Kolkata', 100),
        location: safe(row.from_city || '', 160) || null,
        confirmationRef: safe(row.pnr || row.booking_group || '', 160) || null,
        participants: Array.isArray(row.passengers) ? row.passengers.map((x: unknown) => safe(x, 120)).filter(Boolean) : [],
        metadata: {
          travelTicketId: String(row.id),
          legIndex: Number(row.leg_index || 0),
          airlineCode: code,
          flightNo: safe(row.flight_no || '', 80) || null,
          seat: safe(row.seat || '', 80) || null,
          checkinOpensAt,
          checkInUrl: checkInUrl || null,
          ticketSource: safe(row.source || '', 80) || null,
          autonomousSource: 'travel_ticket_bridge',
        },
        sourceRefs: [
          { type: 'travel_ticket', id: String(row.id) },
          ...(row.pnr ? [{ type: 'booking_reference', present: true }] : []),
        ],
      })
      synced++
      results.push({ ticketId: String(row.id), lifeEventId: registered.id })
    } catch (err: any) {
      failed++
      const message = safe(err?.message || err || 'unknown', 300)
      console.error('TRAVEL_LIFE_EVENT_BRIDGE_SYNC_FAILED:', row?.id, message)
      results.push({ ticketId: String(row?.id || ''), error: message })
    }
  }

  return { checked: (data || []).length, synced, failed, unavailable: false, results }
}
