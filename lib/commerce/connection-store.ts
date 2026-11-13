import {supabaseAdmin} from '@/lib/supabase-admin'
import {encryptVaultValue, decryptVaultValue} from '@/lib/security/vault-crypto'
import {COMMERCE_PROVIDERS, type CommerceProvider} from './providers'
import {refreshCommerceToken, type CommerceToken} from './oauth'
import {acquireBrainUserLease, releaseBrainUserLease} from '@/lib/agent/brain-runtime-guard'

const label = 'Commerce OAuth'
const key = (provider: CommerceProvider) => `commerce_oauth:${provider}`

export async function saveCommerceConnection(owner: string, provider: CommerceProvider, token: CommerceToken) {
  const {error} = await supabaseAdmin.from('vault_credentials').upsert({telegram_id: owner, provider: key(provider), account_label: label,
    username_hint: 'Provider-authorized account', username_ciphertext: encryptVaultValue(owner), secret_ciphertext: encryptVaultValue(JSON.stringify(token)),
    allowed_domains: [new URL(COMMERCE_PROVIDERS[provider].resource).hostname], status: 'active', key_version: 1,
    metadata_json: {kind: 'commerce_oauth', expires_at: token.expiresAt, authorized_at: new Date().toISOString(), provider_read_verified: false},
    updated_at: new Date().toISOString()}, {onConflict: 'telegram_id,provider,account_label'})
  if (error) throw new Error('commerce_connection_save_failed')
}

type Stored = {token: CommerceToken; cipher: string; updatedAt: string; metadata: Record<string, any>}

async function storedRow(owner: string, provider: CommerceProvider): Promise<Stored | null> {
  const {data, error} = await supabaseAdmin.from('vault_credentials').select('secret_ciphertext,status,metadata_json,updated_at')
    .eq('telegram_id', owner).eq('provider', key(provider)).eq('account_label', label).maybeSingle()
  if (error) throw new Error('commerce_connection_read_failed')
  if (!data || data.status !== 'active') return null
  const token = JSON.parse(decryptVaultValue(data.secret_ciphertext)) as CommerceToken
  return token?.accessToken && Number.isFinite(token.expiresAt) ? {token, cipher: data.secret_ciphertext, updatedAt: String(data.updated_at || ''), metadata: data.metadata_json || {}} : null
}

/** The stored token exactly as saved, even if expired, and never refreshed. For disconnect/revoke only. */
export async function readStoredCommerceConnection(owner: string, provider: CommerceProvider): Promise<CommerceToken | null> {
  return (await storedRow(owner, provider))?.token || null
}

const usable = (token: CommerceToken | null, now = Date.now()) => !!token && token.expiresAt > now + 60_000
// Refresh well before expiry: Swiggy says an expired access token cannot be refreshed.
export const COMMERCE_REFRESH_WINDOW_MS = 24 * 60 * 60_000

/** Compare-and-swap on updated_at (every save sets it; short, unlike the ciphertext, so the filter URL stays small):
 *  the refreshed token replaces exactly the row it was refreshed from. A disconnect or a new
 *  sign-in in the meantime (row gone or changed) wins; the refreshed token is then dropped, never resurrected. */
async function saveRefreshed(owner: string, provider: CommerceProvider, from: Stored, fresh: CommerceToken): Promise<boolean> {
  const {data, error} = await supabaseAdmin.from('vault_credentials').update({secret_ciphertext: encryptVaultValue(JSON.stringify(fresh)),
    metadata_json: {...from.metadata, expires_at: fresh.expiresAt, refreshed_at: new Date().toISOString()}, updated_at: new Date().toISOString()})
    .eq('telegram_id', owner).eq('provider', key(provider)).eq('account_label', label).eq('status', 'active').eq('updated_at', from.updatedAt)
    .select('telegram_id').maybeSingle()
  return !error && !!data
}

export async function readCommerceConnection(owner: string, provider: CommerceProvider, request?: typeof fetch): Promise<CommerceToken | null> {
  const row = await storedRow(owner, provider)
  if (!row) return null
  const now = Date.now()
  // Far from expiry, no refresh token, or already expired (cannot be refreshed): no refresh call.
  if (row.token.expiresAt > now + COMMERCE_REFRESH_WINDOW_MS || !row.token.refreshToken || !row.updatedAt || row.token.expiresAt <= now) return usable(row.token) ? row.token : null
  // Rotating refresh tokens: two concurrent refreshes would burn the old token and disconnect the person, so only
  // one runs per owner+provider; anyone else uses the current token while it is still valid.
  const leaseKey = `commerce-refresh:${provider}:${owner}`
  const lease = await acquireBrainUserLease(leaseKey, 30).catch(() => null)
  if (!lease) return usable(row.token) ? row.token : null
  try {
    const latest = await storedRow(owner, provider)
    if (!latest) return null
    // Someone else already refreshed (new ciphertext or a token now outside the window): use theirs.
    if (latest.cipher !== row.cipher || latest.token.expiresAt > Date.now() + COMMERCE_REFRESH_WINDOW_MS) return usable(latest.token) ? latest.token : null
    let fresh: CommerceToken
    try { fresh = await refreshCommerceToken(provider, latest.token, request) } catch { return usable(latest.token) ? latest.token : null }
    // Save before use: a refresh token that is not stored is lost, and the old one no longer works. One retry.
    if (await saveRefreshed(owner, provider, latest, fresh).catch(() => false) || await saveRefreshed(owner, provider, latest, fresh).catch(() => false)) return fresh
    return null
  } finally {
    await releaseBrainUserLease(leaseKey, lease.ownerToken).catch(() => false)
  }
}
export async function deleteCommerceConnection(owner: string, provider: CommerceProvider) {
  const {error} = await supabaseAdmin.from('vault_credentials').delete().eq('telegram_id', owner).eq('provider', key(provider)).eq('account_label', label)
  if (error) throw new Error('commerce_connection_delete_failed')
}
