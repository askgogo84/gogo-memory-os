import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeVaultDomain } from './domain-policy'

// Provider-neutral durable pointer to a browser session held by the provider
// (Browserbase Context id / Steel Profile id). This store NEVER holds secrets or
// browser session bytes — only the opaque external identity id and its status.
// Mirrors the shape and conventions of session-store.ts. Not wired into any runtime path yet.

export type BrowserIdentityProvider = 'browserbase' | 'steel'
export type BrowserIdentityStatus = 'active' | 'needs_reauth' | 'expired' | 'revoked'

export type BrowserIdentity = {
  id: string
  telegramId: string
  domain: string
  provider: BrowserIdentityProvider
  externalIdentityId: string
  status: BrowserIdentityStatus
  lastVerifiedAt: string | null
  updatedAt: string | null
}

// Canonical site key: www./m./login-path variants collapse to one key so a login
// saved on one host is reused across the site's surfaces. Unknown hosts fall back
// to the www-stripped host. No new library — reuses normalizeVaultDomain.
const SITE_KEYS: Array<{ key: string; bases: string[] }> = [
  { key: 'amazon.in', bases: ['amazon.in'] },
  { key: 'flipkart.com', bases: ['flipkart.com'] },
  { key: 'swiggy.com', bases: ['swiggy.com'] },
  { key: 'irctc.co.in', bases: ['irctc.co.in'] },
]

export function canonicalSiteKey(input: string): string {
  const host = normalizeVaultDomain(input)
  if (!host) return ''
  for (const entry of SITE_KEYS) {
    if (entry.bases.some(base => host === base || host.endsWith('.' + base))) return entry.key
  }
  return host
}

function safe(value: unknown, max = 200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

export async function upsertBrowserIdentity(params: {
  telegramId: string
  domain: string
  externalIdentityId: string
  provider?: BrowserIdentityProvider
  status?: BrowserIdentityStatus
  lastVerifiedAt?: string | null
  metadata?: Record<string, unknown>
}): Promise<BrowserIdentity> {
  const telegramId = String(params.telegramId)
  const domain = canonicalSiteKey(params.domain)
  const externalIdentityId = safe(params.externalIdentityId, 200)
  if (!telegramId || !domain || !externalIdentityId) throw new Error('browser_identity_invalid')
  const now = new Date().toISOString()
  const row = {
    telegram_id: telegramId,
    domain,
    provider: params.provider || 'browserbase',
    external_identity_id: externalIdentityId,
    status: params.status || 'active',
    last_verified_at: params.lastVerifiedAt || null,
    metadata_json: params.metadata || {},
    updated_at: now,
  }
  const { data, error } = await supabaseAdmin.from('vault_browser_identities')
    .upsert(row, { onConflict: 'telegram_id,domain,provider' })
    .select('id,telegram_id,domain,provider,external_identity_id,status,last_verified_at,updated_at')
    .single()
  if (error || !data?.id) throw new Error(`browser_identity_upsert_failed:${error?.message || 'unknown'}`)
  return map(data)
}

export async function getBrowserIdentity(
  telegramId: string,
  domain: string,
  provider: BrowserIdentityProvider = 'browserbase',
): Promise<BrowserIdentity | null> {
  const key = canonicalSiteKey(domain)
  if (!key) return null
  const { data, error } = await supabaseAdmin.from('vault_browser_identities')
    .select('id,telegram_id,domain,provider,external_identity_id,status,last_verified_at,updated_at')
    .eq('telegram_id', String(telegramId)).eq('domain', key).eq('provider', provider)
    .maybeSingle()
  if (error) throw new Error(`browser_identity_read_failed:${error.message}`)
  return data ? map(data) : null
}

export async function markBrowserIdentityStatus(params: {
  telegramId: string
  domain: string
  provider?: BrowserIdentityProvider
  status: BrowserIdentityStatus
  lastVerifiedAt?: string | null
}) {
  const key = canonicalSiteKey(params.domain)
  if (!key) throw new Error('browser_identity_invalid')
  const patch: Record<string, unknown> = { status: params.status, updated_at: new Date().toISOString() }
  if (params.lastVerifiedAt !== undefined) patch.last_verified_at = params.lastVerifiedAt
  const { error } = await supabaseAdmin.from('vault_browser_identities').update(patch)
    .eq('telegram_id', String(params.telegramId)).eq('domain', key).eq('provider', params.provider || 'browserbase')
  if (error) throw new Error(`browser_identity_status_failed:${error.message}`)
}

export async function deleteBrowserIdentity(
  telegramId: string,
  domain: string,
  provider: BrowserIdentityProvider = 'browserbase',
) {
  const key = canonicalSiteKey(domain)
  if (!key) return false
  const { error } = await supabaseAdmin.from('vault_browser_identities').delete()
    .eq('telegram_id', String(telegramId)).eq('domain', key).eq('provider', provider)
  if (error) throw new Error(`browser_identity_delete_failed:${error.message}`)
  return true
}

function map(row: any): BrowserIdentity {
  return {
    id: String(row.id),
    telegramId: String(row.telegram_id || ''),
    domain: String(row.domain || ''),
    provider: row.provider,
    externalIdentityId: String(row.external_identity_id || ''),
    status: row.status,
    lastVerifiedAt: row.last_verified_at || null,
    updatedAt: row.updated_at || null,
  }
}
