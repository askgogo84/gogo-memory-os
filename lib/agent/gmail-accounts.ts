// Further Google accounts a person connects (6 Nov, owner: gmail.com and tipplr.in). The first account stays in
// public.users as before; every later one is a row in public.gmail_accounts. Readers ask for all live accounts and
// merge what they find; a missing table means "no extra accounts". Owner-scoped by telegram_id (kept as a string).
import { supabaseAdmin } from '@/lib/supabase-admin'
import { decryptGoogleToken, encryptGoogleToken } from '@/lib/security/google-token-crypto'

export type ExtraGmailAccount = { id: string; email: string; accessToken: string; refreshToken: string }

export async function listExtraGmailAccounts(telegramId: string | number): Promise<ExtraGmailAccount[]> {
  const { data, error } = await supabaseAdmin.from('gmail_accounts').select('id,email,access_token,refresh_token')
    .eq('telegram_id', String(telegramId)).is('disconnected_at', null).order('connected_at', { ascending: true }).limit(5)
  if (error) {
    if (!/does not exist|relation|schema cache/i.test(error.message)) console.error('GMAIL_ACCOUNTS_READ_FAILED:', error.message)
    return []
  }
  return (data || []).map((r: any) => ({ id: String(r.id), email: String(r.email).toLowerCase(), accessToken: decryptGoogleToken(String(r.access_token || '')), refreshToken: decryptGoogleToken(String(r.refresh_token || '')) }))
}

export async function upsertExtraGmailAccount(telegramId: string | number, email: string, tokens: { access_token: string; refresh_token?: string | null; scope?: string | null }) {
  const row: any = { telegram_id: String(telegramId), email: email.toLowerCase(), access_token: encryptGoogleToken(tokens.access_token), scopes: tokens.scope || null, updated_at: new Date().toISOString(), disconnected_at: null }
  if (tokens.refresh_token) row.refresh_token = encryptGoogleToken(tokens.refresh_token)
  const { error } = await supabaseAdmin.from('gmail_accounts').upsert(row, { onConflict: 'telegram_id,email' })
  if (error) throw new Error(`gmail_account_save_failed:${error.message}`)
}

export async function saveExtraAccessToken(id: string, accessToken: string) {
  const { error } = await supabaseAdmin.from('gmail_accounts').update({ access_token: encryptGoogleToken(accessToken), updated_at: new Date().toISOString() }).eq('id', id)
  if (error) console.error('GMAIL_ACCOUNT_TOKEN_PERSIST_FAILED:', error.message)
}

export async function disconnectExtraGmailAccount(telegramId: string | number, email: string) {
  const { data, error } = await supabaseAdmin.from('gmail_accounts').update({ disconnected_at: new Date().toISOString(), access_token: null, refresh_token: null })
    .eq('telegram_id', String(telegramId)).eq('email', email.toLowerCase()).is('disconnected_at', null).select('id')
  if (error) throw new Error(`gmail_account_disconnect_failed:${error.message}`)
  return (data || []).length > 0
}

export const ADD_ACCOUNT_RE = /^\s*(?:(?:please\s+)?(?:connect|add|link)\s+(?:another|a\s+second|one\s+more|my\s+(?:other|work|office|second|tipplr))\s+(?:google\s+account|gmail(?:\s+account)?|email(?:\s+account)?|mailbox|inbox)|(?:connect|add|link)\s+[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\s*[.!]*$/i
export const REMOVE_ACCOUNT_RE = /^\s*(?:(?:please\s+)?(?:disconnect|remove|unlink|stop\s+reading)\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}))\s*[.!]*$/i
