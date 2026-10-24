// Gmail through Composio (stopgap until AskGogo's own Google verification is approved, approved 23 Oct).
// Google's consent screen shows "Composio". Read-only use here: Gmail REST calls go through Composio's
// proxy with the person's own connected account, so the same metadata shapes and scoring apply.
import type { AttentionEmail } from '@/lib/email/attention'

const BASE = 'https://backend.composio.dev/api/v3.1'
export const COMPOSIO_CALLBACK = 'https://app.askgogo.in/dashboard/settings/email?connected=google'

/** Preserve the persisted owner identity exactly. JS Number can alias distinct BIGINT rows. */
export function composioUserId(telegramId: string | number) {
  if (typeof telegramId === 'number' && !Number.isSafeInteger(telegramId)) {
    throw new Error('composio_owner_id_unsafe_number')
  }
  const id = String(telegramId)
  // This is a persisted numeric telegram_id, not a phone number or untrusted alias.
  // Reject rounded, non-canonical, out-of-range identities instead of linking to another account.
  if (!/^-?[1-9]\\d{0,18}$/.test(id)) throw new Error('composio_owner_id_invalid')
  const numeric = BigInt(id)
  if (numeric < -(1n << 63n) || numeric > (1n << 63n) - 1n) throw new Error('composio_owner_id_invalid')
  return `askgogo-${id}`
}

export function composioConfigured() {
  return Boolean(process.env.COMPOSIO_API_KEY)
}

async function composio(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | string[]> } = {}) {
  const key = process.env.COMPOSIO_API_KEY
  if (!key) throw new Error('composio_not_configured')
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(init.query || {})) for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 12_000)
  try {
    const res = await fetch(url, {
      method: init.method || 'GET', signal: ctrl.signal, cache: 'no-store',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
    const text = await res.text()
    let data: any = null
    try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 300) } }
    if (!res.ok) throw new Error(`composio_${res.status}:${String(data?.error?.message || data?.message || text).slice(0, 160)}`)
    return data
  } finally { clearTimeout(timer) }
}

let cachedAuthConfig: string | null = null

/** The project's Gmail auth config (Composio-managed OAuth). Env override, else find one, else create one. */
export async function gmailAuthConfigId() {
  if (process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID) return process.env.COMPOSIO_GMAIL_AUTH_CONFIG_ID
  if (cachedAuthConfig) return cachedAuthConfig
  const list = await composio('/auth_configs', { query: { toolkit_slug: 'gmail' } })
  const existing = (list?.items || []).find((c: any) => String(c?.toolkit?.slug || '').toLowerCase() === 'gmail' && c?.status !== 'DISABLED' && !c?.is_disabled)
  if (existing?.id) return (cachedAuthConfig = String(existing.id))
  const created = await composio('/auth_configs', { method: 'POST', body: { toolkit: { slug: 'gmail' }, auth_config: { type: 'use_composio_managed_auth', name: 'AskGogo Gmail' } } })
  const id = created?.auth_config?.id || created?.id
  if (!id) throw new Error('composio_auth_config_missing')
  return (cachedAuthConfig = String(id))
}

export async function createGmailConnectLink(telegramId: number) {
  const out = await composio('/connected_accounts/link', { method: 'POST', body: { auth_config_id: await gmailAuthConfigId(), user_id: composioUserId(telegramId), callback_url: COMPOSIO_CALLBACK } })
  const url = String(out?.redirect_url || '')
  if (!/^https:\/\//.test(url)) throw new Error('composio_link_missing')
  return url
}

export async function activeGmailAccount(telegramId: number): Promise<string | null> {
  if (!composioConfigured()) return null
  const out = await composio('/connected_accounts', { query: { user_ids: composioUserId(telegramId), toolkit_slugs: 'gmail', statuses: 'ACTIVE', limit: '5' } })
  const item = (out?.items || []).find((a: any) => a?.status === 'ACTIVE' && !a?.is_disabled && a?.user_id === composioUserId(telegramId))
  return item?.id ? String(item.id) : null
}

async function gmailGet(accountId: string, endpoint: string) {
  const out = await composio('/tools/execute/proxy', { method: 'POST', body: { endpoint, method: 'GET', connected_account_id: accountId, connectedAccountId: accountId } })
  const status = Number(out?.status ?? 200)
  if (status >= 400) throw new Error(`composio_gmail_${status}`)
  return out?.data ?? out
}

function header(headers: any[], name: string) {
  return String((headers || []).find((h: any) => String(h?.name || '').toLowerCase() === name.toLowerCase())?.value || '')
}

const META = ['Subject', 'From', 'To', 'Date', 'Message-ID', 'List-Id', 'List-Unsubscribe', 'Precedence', 'Auto-Submitted'].map(h => `metadataHeaders=${encodeURIComponent(h)}`).join('&')

/** Recent thread heads (last 7 days) as AttentionEmail rows, plus who the person writes to. Read-only. */
export async function fetchComposioRecentEmails(telegramId: number) {
  const accountId = await activeGmailAccount(telegramId)
  if (!accountId) return null
  const G = 'https://gmail.googleapis.com/gmail/v1/users/me'
  const [profile, list] = await Promise.all([
    gmailGet(accountId, `${G}/profile`).catch(() => null),
    gmailGet(accountId, `${G}/messages?maxResults=40&q=${encodeURIComponent('newer_than:7d -in:spam -in:trash')}`),
  ])
  const ownEmail = String(profile?.emailAddress || '').toLowerCase() || null
  const threadIds = [...new Set<string>((list?.messages || []).map((m: any) => String(m?.threadId || '')).filter(Boolean))].slice(0, 15)
  const threads = await Promise.all(threadIds.map(id => gmailGet(accountId, `${G}/threads/${encodeURIComponent(id)}?format=metadata&${META}`).catch(() => null)))
  const emails: AttentionEmail[] = []
  const repliedSenders = new Set<string>()
  for (const t of threads) {
    const msgs = (t?.messages || []).map((m: any) => {
      const h = m?.payload?.headers || []
      const labels = Array.isArray(m?.labelIds) ? m.labelIds : []
      return {
        id: String(m?.id || ''), threadId: String(m?.threadId || t?.id || ''), messageId: header(h, 'Message-ID'), from: header(h, 'From'), to: header(h, 'To'),
        subject: header(h, 'Subject') || '(No subject)', snippet: String(m?.snippet || ''), date: header(h, 'Date'), internalDate: Number(m?.internalDate || 0),
        labelIds: labels, isUnread: labels.includes('UNREAD'), listId: header(h, 'List-Id'), listUnsubscribe: header(h, 'List-Unsubscribe'),
        precedence: header(h, 'Precedence'), autoSubmitted: header(h, 'Auto-Submitted'), source: 'composio' as const,
      }
    }).filter((m: any) => m.id).sort((a: any, b: any) => a.internalDate - b.internalDate)
    for (const m of msgs) if (ownEmail && m.from.toLowerCase().includes(ownEmail)) for (const addr of m.to.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []) repliedSenders.add(addr.toLowerCase())
    if (msgs.length) emails.push(msgs[msgs.length - 1])
  }
  return { emails, ownEmail, repliedSenders }
}

// ---------- Google Drive through Composio (same stopgap, 24 Oct) ----------
export const DRIVE_CALLBACK = 'https://app.askgogo.in/dashboard/connections?connected=drive'
const authConfigCache = new Map<string, string>()

/** Composio-managed OAuth config for a toolkit (env override per toolkit, else find, else create). */
export async function toolkitAuthConfigId(toolkit: 'googledrive') {
  const env = process.env.COMPOSIO_GOOGLEDRIVE_AUTH_CONFIG_ID
  if (env) return env
  if (authConfigCache.has(toolkit)) return authConfigCache.get(toolkit)!
  const list = await composio('/auth_configs', { query: { toolkit_slug: toolkit } })
  const existing = (list?.items || []).find((c: any) => String(c?.toolkit?.slug || '').toLowerCase() === toolkit && c?.status !== 'DISABLED' && !c?.is_disabled)
  let id = existing?.id
  if (!id) {
    const created = await composio('/auth_configs', { method: 'POST', body: { toolkit: { slug: toolkit }, auth_config: { type: 'use_composio_managed_auth', name: 'AskGogo Google Drive' } } })
    id = created?.auth_config?.id || created?.id
  }
  if (!id) throw new Error('composio_auth_config_missing')
  authConfigCache.set(toolkit, String(id))
  return String(id)
}

export async function createDriveConnectLink(telegramId: string | number) {
  const out = await composio('/connected_accounts/link', { method: 'POST', body: { auth_config_id: await toolkitAuthConfigId('googledrive'), user_id: composioUserId(telegramId), callback_url: DRIVE_CALLBACK } })
  const url = String(out?.redirect_url || '')
  if (!/^https:\/\//.test(url)) throw new Error('composio_link_missing')
  return url
}

/** Active Drive account for any of the person's ids (dashboard row and WhatsApp chat id). */
export async function activeDriveAccount(telegramIds: Array<string | number>): Promise<string | null> {
  if (!composioConfigured() || !telegramIds.length) return null
  const users = [...new Set(telegramIds.map(id => composioUserId(id)))]
  const out = await composio('/connected_accounts', { query: { user_ids: users, toolkit_slugs: 'googledrive', statuses: 'ACTIVE', limit: '10' } })
  const item = (out?.items || []).find((a: any) => a?.status === 'ACTIVE' && !a?.is_disabled && users.includes(a?.user_id))
  return item?.id ? String(item.id) : null
}

/** A Drive REST GET through Composio's proxy, returned as a fetch Response so existing Drive code reads it unchanged. */
export async function composioDriveFetch(accountId: string, url: string): Promise<Response> {
  if (!/^https:\/\/www\.googleapis\.com\/drive\/v3\//.test(url)) throw new Error('composio_drive_url_not_allowed')
  const out = await composio('/tools/execute/proxy', { method: 'POST', body: { endpoint: url, method: 'GET', connected_account_id: accountId, connectedAccountId: accountId } })
  const status = Number(out?.status ?? 200)
  const data = out?.data ?? out
  const body = typeof data === 'string' ? data : JSON.stringify(data)
  return new Response(body, { status: status >= 100 && status < 600 ? status : 200, headers: { 'content-type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json' } })
}
