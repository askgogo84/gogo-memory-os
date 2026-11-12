import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { enabled, hash, jsonBody, pairingCode, reply, scope } from '@/lib/tv/protocol'

async function account() {
  const session = await getSession()
  const telegramId = Number(session?.telegramId)
  if (!session || !Number.isSafeInteger(telegramId) || String(telegramId) !== session.telegramId || !telegramId) return null
  const { data, error } = await supabaseAdmin.from('users').select('id,whatsapp_id,access_status')
    .eq('telegram_id', telegramId).maybeSingle()
  if (error || !data?.whatsapp_id || ![null, 'active'].includes(data.access_status)) return null
  return String(data.id)
}

export async function GET() {
  const owner = await account()
  if (!owner) return reply({ error: 'unauthorized' }, 401)
  const { data, error } = await supabaseAdmin.from('tv_pairings').select('id,approved_at,expires_at')
    .eq('owner_id', owner).is('revoked_at', null).gt('expires_at', new Date().toISOString())
    .order('approved_at', { ascending: false }).limit(50)
  return error ? reply({ error: 'unavailable' }, 503) : reply({ devices: data, pairingEnabled: enabled() })
}

export async function POST(request: Request) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked
  const owner = await account()
  if (!owner) return reply({ error: 'unauthorized' }, 401)
  const body = await jsonBody(request)
  const now = new Date()
  if (body?.action === 'revoke' && typeof body.id === 'string' &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(body.id)) {
    const { error } = await supabaseAdmin.from('tv_pairings').update({ revoked_at: now.toISOString() })
      .eq('owner_id', owner).eq('id', body.id).is('revoked_at', null)
    return error ? reply({ error: 'unavailable' }, 503) : reply({ revoked: true })
  }
  if (!enabled()) return reply({ error: 'disabled' }, 404)
  const code = pairingCode(body?.code)
  if (!code || body?.action !== 'approve') return reply({ error: 'invalid_request' }, 400)
  const { data, error } = await supabaseAdmin.rpc('tv_approve_pairing', {
    p_owner_id: owner, p_code_hash: hash(code),
  })
  if (error) return reply({ error: 'unavailable' }, 503)
  return data ? reply({ paired: true }) : reply({ error: 'invalid_expired_or_limit' }, 409)
}
