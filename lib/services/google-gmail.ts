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
