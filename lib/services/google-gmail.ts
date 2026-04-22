function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    promise
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((err) => {
        clearTimeout(timer)
        reject(err)
      })
  })
}

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

async function gmailFetchJson(accessToken: string, url: string) {
  const res = await withTimeout(
    fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    }),
    12000
  )

  const data = await res.json()
  return { ok: res.ok, status: res.status, data }
}

async function listMessages(accessToken: string, maxResults: number, mode: 'latest' | 'unread') {
  let url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&labelIds=INBOX`

  if (mode === 'unread') {
    url += '&q=is:unread'
  }

  const res = await gmailFetchJson(accessToken, url)

  if (!res.ok) {
    console.error('Gmail list messages failed:', res.data)
    throw new Error(res.data?.error?.message || 'Failed to list Gmail messages')
  }

  return res.data.messages || []
}

async function fetchMessageMeta(accessToken: string, messageId: string) {
  const detail = await gmailFetchJson(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata`
  )

  if (!detail.ok) {
    console.error('Gmail message fetch failed:', detail.data)
    return null
  }

  const headers = detail.data.payload?.headers || []
  const labelIds = detail.data.labelIds || []

  return {
    id: detail.data.id,
    subject: getHeader(headers, 'Subject') || '(No subject)',
    from: getHeader(headers, 'From') || 'Unknown sender',
    date: getHeader(headers, 'Date') || '',
    snippet: detail.data.snippet || '',
    isUnread: labelIds.includes('UNREAD'),
  }
}

export async function fetchEmails(accessToken: string, mode: 'latest' | 'unread' = 'latest', maxResults = 3) {
  let messages = []

  try {
    messages = await listMessages(accessToken, maxResults, mode)
    if (!messages.length && mode === 'latest') {
      const fallback = await gmailFetchJson(
        accessToken,
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`
      )
      if (fallback.ok) {
        messages = fallback.data.messages || []
      }
    }
  } catch (err) {
    console.error('Gmail list fallback failed:', err)
    return []
  }

  if (!messages.length) return []

  const settled = await Promise.allSettled(
    messages.slice(0, maxResults).map((msg: any) => fetchMessageMeta(accessToken, msg.id))
  )

  return settled
    .filter((x): x is PromiseFulfilledResult<any> => x.status === 'fulfilled')
    .map((x) => x.value)
    .filter(Boolean)
}

export async function fetchLatestEmails(accessToken: string, maxResults = 3) {
  return fetchEmails(accessToken, 'latest', maxResults)
}

export async function fetchUnreadEmails(accessToken: string, maxResults = 3) {
  return fetchEmails(accessToken, 'unread', maxResults)
}
