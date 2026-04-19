export function getAuthUrl(telegramId: number): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: 'https://app.askgogo.in/api/calendar/callback',
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar',
    access_type: 'offline',
    prompt: 'consent',
    state: String(telegramId),
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
        redirect_uri: 'https://app.askgogo.in/api/calendar/callback',
        grant_type: 'authorization_code',
      }),
    })
    const data = await response.json()
    if (data.access_token) return data
    console.error('Token exchange failed:', data)
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

export async function getTodayEvents(accessToken: string): Promise<any[]> {
  const now = new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(now)
  endOfDay.setHours(23, 59, 59, 999)

  const params = new URLSearchParams({
    timeMin: startOfDay.toISOString(),
    timeMax: endOfDay.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
  })

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  )
  const data = await response.json()
  return data.items || []
}