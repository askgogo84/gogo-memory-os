import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const CALENDAR_CALLBACK_URL = 'https://app.askgogo.in/api/calendar/callback'
const CALENDAR_STATE_TTL_MS = 10 * 60 * 1000
const CALENDAR_CONNECT_TTL_MS = 15 * 60 * 1000

type CalendarState = { tg:number; purpose:'calendar_oauth'|'calendar_connect'; exp:number; nonce:string }

function calendarStateSecret() {
  return process.env.CALENDAR_OAUTH_STATE_SECRET || process.env.GMAIL_OAUTH_STATE_SECRET || process.env.CRON_SECRET || ''
}
function calendarSignature(encoded:string) {
  const secret=calendarStateSecret()
  if(!secret)return null
  return createHmac('sha256',secret).update(encoded).digest('base64url')
}
function encodeCalendarState(payload:CalendarState) {
  const encoded=Buffer.from(JSON.stringify(payload),'utf8').toString('base64url')
  const signature=calendarSignature(encoded)
  return signature?`${encoded}.${signature}`:null
}
function decodeCalendarState(token:string,purpose:CalendarState['purpose']) {
  const [encoded,supplied]=String(token||'').split('.')
  if(!encoded||!supplied)return null
  const expected=calendarSignature(encoded)
  if(!expected)return null
  const a=Buffer.from(supplied),b=Buffer.from(expected)
  if(a.length!==b.length||!timingSafeEqual(a,b))return null
  try{
    const payload=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')) as CalendarState
    if(payload?.purpose!==purpose||!Number.isFinite(payload?.tg)||payload.tg<=0)return null
    if(!Number.isFinite(payload?.exp)||payload.exp<=Date.now()||!payload?.nonce)return null
    return payload
  }catch{return null}
}

export function buildCalendarConnectUrl(telegramId:number):string|null {
  if(!Number.isFinite(telegramId)||telegramId<=0)return null
  const token=encodeCalendarState({tg:telegramId,purpose:'calendar_connect',exp:Date.now()+CALENDAR_CONNECT_TTL_MS,nonce:randomBytes(16).toString('base64url')})
  return token?`https://app.askgogo.in/api/calendar/connect?token=${encodeURIComponent(token)}`:null
}
export function verifyCalendarConnectToken(token:string):number|null {
  return decodeCalendarState(token,'calendar_connect')?.tg||null
}
export function consumeCalendarOauthState(state:string):number|null {
  return decodeCalendarState(state,'calendar_oauth')?.tg||null
}

export function getAuthUrl(telegramId: number): string {
  const state=encodeCalendarState({tg:telegramId,purpose:'calendar_oauth',exp:Date.now()+CALENDAR_STATE_TTL_MS,nonce:randomBytes(16).toString('base64url')})
  if(!state)throw new Error('calendar_oauth_state_secret_missing')
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: CALENDAR_CALLBACK_URL,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events',
    access_type: 'offline',
    prompt: 'consent',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string } | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: CALENDAR_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
      cache:'no-store',
    })
    const data = await response.json()
    if (data.access_token) return data
    console.error('Token exchange failed:', data?.error || response.status)
    return null
  } catch (err) {
    console.error('Token exchange error:', err)
    return null
  }
}

export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
      }),
      cache:'no-store',
    })
    const data = await response.json()
    return data.access_token || null
  } catch (err) {
    console.error('Token refresh error:', err)
    return null
  }
}

export async function createCalendarEvent(
  accessToken: string,
  summary: string,
  startTime: string,
  endTime: string,
  location?: string
): Promise<any> {
  const event = {
    summary,
    start: { dateTime: startTime, timeZone: 'Asia/Kolkata' },
    end: { dateTime: endTime, timeZone: 'Asia/Kolkata' },
    ...(location ? { location } : {}),
  }

  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    }
  )
  return response.json()
}

export async function fetchPrimaryCalendarEvents(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  label = 'GCAL_EVENTS_FETCH_FAILED',
): Promise<any[]> {
  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: 'true',
    orderBy: 'startTime',
  })

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      cache: 'no-store',
    }
  )
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    console.error(`${label}:`, response.status, body.slice(0, 300))
    throw new Error(`Google Calendar events fetch failed: ${response.status}`)
  }
  const data = await response.json()
  return data.items || []
}

export async function getTodayEvents(accessToken: string): Promise<any[]> {
  const now = new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)

  return fetchPrimaryCalendarEvents(
    accessToken,
    startOfDay.toISOString(),
    endOfDay.toISOString(),
    'GCAL_TODAY_EVENTS_FAILED',
  )
}

export async function listUpcomingEvents(accessToken: string, days = 7): Promise<any[]> {
  const now = new Date()
  const timeMax = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  const params = new URLSearchParams({
    timeMin: now.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '50',
  })
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache:'no-store' }
  )
  const data = await response.json()
  return data.items || []
}

export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  patch: { summary?: string; startTime?: string; endTime?: string; location?: string }
): Promise<{ ok: boolean; event?: any; error?: string }> {
  const body: any = {}
  if (patch.summary) body.summary = patch.summary
  if (patch.startTime) body.start = { dateTime: patch.startTime, timeZone: 'Asia/Kolkata' }
  if (patch.endTime) body.end = { dateTime: patch.endTime, timeZone: 'Asia/Kolkata' }
  if (patch.location) body.location = patch.location

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )
  const data = await response.json().catch(() => ({}))
  if (!response.ok) return { ok: false, error: data?.error?.message || `HTTP ${response.status}` }
  return { ok: true, event: data }
}

export async function deleteCalendarEvent(accessToken: string, eventId: string): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (response.ok || response.status === 410) return { ok: true }
  const data = await response.json().catch(() => ({}))
  return { ok: false, error: data?.error?.message || `HTTP ${response.status}` }
}
