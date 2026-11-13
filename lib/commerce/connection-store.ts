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

async function storedToken(owner: string, provider: CommerceProvider): Promise<CommerceToken | null> {
  const {data, error} = await supabaseAdmin.from('vault_credentials').select('secret_ciphertext,status')
    .eq('telegram_id', owner).eq('provider', key(provider)).eq('account_label', label).maybeSingle()
  if (error) throw new Error('commerce_connection_read_failed')
  if (!data || data.status !== 'active') return null
  const token = JSON.parse(decryptVaultValue(data.secret_ciphertext)) as CommerceToken
  return token?.accessToken && Number.isFinite(token.expiresAt) ? token : null
}

const usable = (token: CommerceToken | null, now = Date.now()) => !!token && token.expiresAt > now + 60_000
// Refresh well before expiry: Swiggy says an expired access token cannot be refreshed.
export const COMMERCE_REFRESH_WINDOW_MS = 24 * 60 * 60_000

export async function readCommerceConnection(owner: string, provider: CommerceProvider, request?: typeof fetch): Promise<CommerceToken | null> {
  const token = await storedToken(owner, provider)
  if (!token) return null
  if (token.expiresAt > Date.now() + COMMERCE_REFRESH_WINDOW_MS || !token.refreshToken) return usable(token) ? token : null
  // Rotating refresh tokens: two concurrent refreshes would burn the old token and disconnect the person, so only
  // one runs per owner+provider; anyone else uses the current token while it is still valid.
  const lease = await acquireBrainUserLease(`commerce-refresh:${provider}:${owner}`, 30).catch(() => null)
  if (!lease) return usable(token) ? token : null
  try {
    const latest = await storedToken(owner, provider)
    if (!latest) return null
    if (latest.refreshToken !== token.refreshToken) return usable(latest) ? latest : null // another call refreshed it
    let fresh: CommerceToken
    try { fresh = await refreshCommerceToken(provider, latest, request) } catch { return usable(latest) ? latest : null }
    // Save before use: a refresh token that is not stored is lost, and the old one no longer works.
    try { await saveCommerceConnection(owner, provider, fresh) } catch { return null }
    return fresh
  } finally {
    await releaseBrainUserLease(`commerce-refresh:${provider}:${owner}`, lease.ownerToken).catch(() => false)
  }
}

export async function deleteCommerceConnection(owner: string, provider: CommerceProvider) {
  const {error} = await supabaseAdmin.from('vault_credentials').delete().eq('telegram_id', owner).eq('provider', key(provider)).eq('account_label', label)
  if (error) throw new Error('commerce_connection_delete_failed')
}
