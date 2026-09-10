import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

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

const GMAIL_CALLBACK_URL = 'https://app.askgogo.in/api/gmail/callback'
const CONNECT_TTL_MS = 15 * 60 * 1000
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

// One deliberately read-only Google Workspace consent. Sending email, modifying
// Drive files and changing Calendar remain separate approval-gated capabilities.
export const GOOGLE_WORKSPACE_READ_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
] as const

type SignedGoogleState = {
  tg: number
  purpose: 'connect' | 'oauth'
  exp: number
  nonce: string
}

function stateSecret() {
  return process.env.GMAIL_OAUTH_STATE_SECRET || process.env.CRON_SECRET || ''
}

function sign(encoded: string) {
  const secret = stateSecret()
  if (!secret) return null
  return createHmac('sha256', secret).update(encoded).digest('base64url')
}

function encodeState(payload: SignedGoogleState) {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = sign(encoded)
  return signature ? `${encoded}.${signature}` : null
}

function decodeState(token: string, purpose: SignedGoogleState['purpose']): SignedGoogleState | null {
  const [encoded, supplied] = String(token || '').split('.')
  if (!encoded || !supplied) return null
  const expected = sign(encoded)
  if (!expected) return null
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SignedGoogleState
    if (payload?.purpose !== purpose || !Number.isFinite(payload?.tg) || payload.tg <= 0) return null
    if (!Number.isFinite(payload?.exp) || payload.exp <= Date.now()) return null
    if (!payload?.nonce || String(payload.nonce).length < 12) return null
    return payload
  } catch {
    return null
  }
}

export function buildGmailConnectUrl(telegramId: number): string | null {
  if (!Number.isFinite(telegramId) || telegramId <= 0) return null
  const token = encodeState({
    tg: telegramId,
    purpose: 'connect',
    exp: Date.now() + CONNECT_TTL_MS,
    nonce: randomBytes(16).toString('base64url'),
  })
  return token ? `https://app.askgogo.in/api/gmail/connect?token=${encodeURIComponent(token)}` : null
}

export function verifyGmailConnectToken(token: string): number | null {
  return decodeState(token, 'connect')?.tg || null
}

function issueGmailOauthState(telegramId: number): string | null {
  return encodeState({
    tg: telegramId,
    purpose: 'oauth',
    exp: Date.now() + OAUTH_STATE_TTL_MS,
    nonce: randomBytes(16).toString('base64url'),
  })
}

export function consumeGmailOauthState(state: string): number | null {
  return decodeState(state, 'oauth')?.tg || null
}

export function getGmailAuthUrl(telegramId: number): string | null {
  const state = issueGmailOauthState(telegramId)
  if (!state) return null
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID || '',
    redirect_uri: GMAIL_CALLBACK_URL,
    response_type: 'code',
    scope: GOOGLE_WORKSPACE_READ_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

export async function exchangeGmailCode(
  code: string
): Promise<{ access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string } | null> {
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: GMAIL_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
      cache: 'no-store',
    })

    const data = await response.json()
    if (response.ok && data.access_token) return data

    console.error('Gmail token exchange failed:', data?.error || response.status)
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
      cache: 'no-store',
    })

    const data = await response.json()
    return response.ok && data.email ? String(data.email).toLowerCase() : null
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
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        grant_type: 'refresh_token',
      }),
      cache: 'no-store',
    })

    const data = await response.json()
    return response.ok && data.access_token ? String(data.access_token) : null
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
    console.error('Gmail list messages failed:', res.status)
    throw new Error(res.status === 403 ? 'gmail_scope_required' : 'Failed to list Gmail messages')
  }

  return res.data.messages || []
}

async function fetchMessageMeta(accessToken: string, messageId: string) {
  const detail = await gmailFetchJson(
    accessToken,
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Message-ID`
  )

  if (!detail.ok) {
    console.error('Gmail message fetch failed:', detail.status)
    return null
  }

  const headers = detail.data.payload?.headers || []
  const labelIds = detail.data.labelIds || []

  return {
    id: detail.data.id,
    threadId: detail.data.threadId || null,
    subject: getHeader(headers, 'Subject') || '(No subject)',
    from: getHeader(headers, 'From') || 'Unknown sender',
    to: getHeader(headers, 'To') || '',
    messageId: getHeader(headers, 'Message-ID') || '',
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
      if (fallback.ok) messages = fallback.data.messages || []
    }
  } catch (err) {
    if (err instanceof Error && err.message === 'gmail_scope_required') throw err
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
