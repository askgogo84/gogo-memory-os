// Durable pending sign-up credentials (table: vault_pending_credentials).
//
// Flow: create the pending row BEFORE the sign-up form is submitted; read it to commit only after
// the site's own success state is verified; then move the secret into vault_credentials and wipe
// the ciphertext here. A rejected sign-up is discarded. Rows past expires_at are expired and wiped.
//
// Recovery: a pending row survives a process restart, so an interrupted sign-up can be found
// with listPendingSignupCredentials and resolved, never guessed.
//
// Secrets: the payload is encrypted with the vault master key. Nothing returned from this module
// except readPendingSignupForCommit contains a secret, and that function is host-only.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { decryptVaultValue, encryptVaultValue } from '@/lib/security/vault-crypto'

export type PendingSignupMeta = {
  id: string
  domain: string
  runId: string | null
  status: 'pending' | 'committed' | 'discarded' | 'expired'
  createdAt: string
  expiresAt: string
}

const META_COLUMNS = 'id,domain,run_id,status,created_at,expires_at'

function toMeta(row: any): PendingSignupMeta {
  return {
    id: String(row.id),
    domain: String(row.domain),
    runId: row.run_id ? String(row.run_id) : null,
    status: row.status,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  }
}

export async function createPendingSignupCredential(params: {
  telegramId: string
  runId: string
  domain: string
  username: string
  secret: string
}): Promise<PendingSignupMeta> {
  const telegramId = String(params.telegramId || '').trim()
  const runId = String(params.runId || '').trim()
  const domain = String(params.domain || '').trim().toLowerCase()
  const username = String(params.username || '').trim()
  const secret = String(params.secret || '')
  if (!telegramId || !runId || !domain || !username || !secret) throw new Error('pending_credential_invalid')
  const payload = encryptVaultValue(JSON.stringify({ username, secret }))
  const { data, error } = await supabaseAdmin
    .from('vault_pending_credentials')
    .insert({ telegram_id: telegramId, run_id: runId, domain, payload_ciphertext: payload })
    .select(META_COLUMNS)
    .single()
  if (error) {
    // The unique index allows one pending row per run; a second attempt is refused, not retried.
    if (String((error as any).code) === '23505') throw new Error('pending_credential_already_started')
    throw new Error('pending_credential_create_failed')
  }
  return toMeta(data)
}

// Host-only. Returns the username and secret for committing a verified sign-up.
export async function readPendingSignupForCommit(params: { telegramId: string; pendingId: string }) {
  const { data, error } = await supabaseAdmin
    .from('vault_pending_credentials')
    .select('domain,payload_ciphertext')
    .eq('id', params.pendingId)
    .eq('telegram_id', String(params.telegramId))
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (error || !data) throw new Error('pending_credential_missing_or_expired')
  const decoded = JSON.parse(decryptVaultValue(data.payload_ciphertext) || '{}')
  if (!decoded.username || !decoded.secret) throw new Error('pending_credential_unreadable')
  return { domain: String(data.domain), username: String(decoded.username), secret: String(decoded.secret) }
}

// Call only after the Vault row for this sign-up has been saved.
export async function markPendingSignupCommitted(params: {
  telegramId: string
  pendingId: string
  credentialId: string
}): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('vault_pending_credentials')
    .update({
      status: 'committed',
      payload_ciphertext: '',
      committed_credential_id: params.credentialId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.pendingId)
    .eq('telegram_id', String(params.telegramId))
    .eq('status', 'pending')
    .select('id')
  if (error || !data?.length) throw new Error('pending_credential_commit_failed')
}

// Call only when the site clearly rejected the sign-up. If the outcome is unclear, leave the row
// pending so it can be recovered; never discard the only copy of a password the site accepted.
export async function discardPendingSignupCredential(params: { telegramId: string; pendingId: string }): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('vault_pending_credentials')
    .update({ status: 'discarded', payload_ciphertext: '', updated_at: new Date().toISOString() })
    .eq('id', params.pendingId)
    .eq('telegram_id', String(params.telegramId))
    .eq('status', 'pending')
    .select('id')
  if (error) throw new Error('pending_credential_discard_failed')
  return Boolean(data?.length)
}

// Secret-free list for recovery.
export async function listPendingSignupCredentials(telegramId: string): Promise<PendingSignupMeta[]> {
  const { data, error } = await supabaseAdmin
    .from('vault_pending_credentials')
    .select(META_COLUMNS)
    .eq('telegram_id', String(telegramId))
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw new Error('pending_credential_list_failed')
  return (data || []).map(toMeta)
}

// Expire and wipe rows past their window. Intended for a scheduled sweep.
export async function expireStalePendingSignupCredentials(): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('vault_pending_credentials')
    .update({ status: 'expired', payload_ciphertext: '', updated_at: new Date().toISOString() })
    .eq('status', 'pending')
    .lt('expires_at', new Date().toISOString())
    .select('id')
  if (error) throw new Error('pending_credential_expire_failed')
  return data?.length || 0
}
