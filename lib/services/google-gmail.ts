export function getGmailAuthUrl(telegramId: number): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: 'https://app.askgogo.in/api/gmail/callback',
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state: String(telegramId),
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGmailCode(
  code: string
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number } | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: 'https://app.askgogo.in/api/gmail/callback',
        grant_type: 'authorization_code',
      }),
    })

    const data = await response.json()
    if (data.access_token) return data

    console.error('Gmail token exchange failed:', data)
    return null
  } catch (err) {
    console.error('Gmail token exchange error:', err)
    return null
  }
}

export async function getGoogleEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    })

    const data = await response.json()
    return data.email || null
  } catch (err) {
    console.error('Get Google email failed:', err)
    return null
  }
}

export async function refreshGmailAccessToken(refreshToken: string): Promise<string | null> {
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
    console.error('Refresh Gmail token failed:', err)
    return null
  }
}

function getHeader(headers: any[], name: string) {
  const h = (headers || []).find((x) => x.name?.toLowerCase() === name.toLowerCase())
  return h?.value || ''
}

async function listMessages(accessToken: string, maxResults: number, inboxOnly: boolean) {
  const base = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`
  const url = inboxOnly ? `${base}&labelIds=INBOX` : base

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })

  const data = await res.json()

  if (!res.ok) {
    console.error('Gmail list messages failed:', data)
    throw new Error(data?.error?.message || 'Failed to list Gmail messages')
  }

  return data.messages || []
}

export async function fetchLatestEmails(accessToken: string, maxResults = 5) {
  let messages = await listMessages(accessToken, maxResults, true)

  if (!messages.length) {
    messages = await listMessages(accessToken, maxResults, false)
  }

  const detailed = []

  for (const msg of messages) {
    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store',
      }
    )

    const data = await res.json()

    if (!res.ok) {
      console.error('Gmail message fetch failed:', data)
      continue
    }

    const headers = data.payload?.headers || []

    detailed.push({
      id: data.id,
      subject: getHeader(headers, 'Subject') || '(No subject)',
      from: getHeader(headers, 'From') || 'Unknown sender',
      date: getHeader(headers, 'Date') || '',
      snippet: data.snippet || '',
    })
  }

  return detailed
}
