import {supabaseAdmin} from '@/lib/supabase-admin'
import {encryptVaultValue, decryptVaultValue} from '@/lib/security/vault-crypto'
import {COMMERCE_PROVIDERS, type CommerceProvider} from './providers'
import type {CommerceToken} from './oauth'

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

export async function readCommerceConnection(owner: string, provider: CommerceProvider): Promise<CommerceToken | null> {
  const {data, error} = await supabaseAdmin.from('vault_credentials').select('secret_ciphertext,status')
    .eq('telegram_id', owner).eq('provider', key(provider)).eq('account_label', label).maybeSingle()
  if (error) throw new Error('commerce_connection_read_failed')
  if (!data || data.status !== 'active') return null
  const token = JSON.parse(decryptVaultValue(data.secret_ciphertext)) as CommerceToken
  if (!token.accessToken || !Number.isFinite(token.expiresAt) || token.expiresAt <= Date.now() + 60_000) return null
  return token
}

export async function deleteCommerceConnection(owner: string, provider: CommerceProvider) {
  const {error} = await supabaseAdmin.from('vault_credentials').delete().eq('telegram_id', owner).eq('provider', key(provider)).eq('account_label', label)
  if (error) throw new Error('commerce_connection_delete_failed')
}
