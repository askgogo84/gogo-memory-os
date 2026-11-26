
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { enabled, hash, jsonBody, pairingCode, reply, scope, shortCodeHash } from '@/lib/tv/protocol'

async function account() {
  const session = await getSession()
  const telegramId = Number(session?.telegramId)
  if (!session || !Number.isSafeInteger(telegramId) || String(telegramId) !== session.telegramId || !telegramId) return null
  const { data, error } = await supabaseAdmin.from('users').select('id,whatsapp_id,access_status')
    .eq('telegram_id', telegramId).maybeSingle()
  if (error || !data?.whatsapp_id || ![null, 'active'].includes(data.access_status)) return null
  return String(data.id)
}

const deviceId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value)

export async function GET() {
  const owner = await account()
  if (!owner) return reply({ error: 'unauthorized' }, 401)
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin.from('tv_pairings')
    .select('id,device_name,approved_at,consent_at,expires_at').eq('scope', scope)
    .eq('owner_id', owner).is('revoked_at', null)
    .or(`expires_at.gt.${now},and(approved_at.is.null,pair_expires_at.gt.${now})`)
    .order('created_at', { ascending: false }).limit(50)
  return error ? reply({ error: 'unavailable' }, 503) : reply({ devices: data, pairingEnabled: enabled() })
}

export async function POST(request: Request) {
  const blocked = verifySameOrigin(request)
  if (blocked) return reply({ error: 'forbidden' }, blocked.status)
  const owner = await account()
  if (!owner) return reply({ error: 'unauthorized' }, 401)
  const body = await jsonBody(request)
  if (body?.action === 'revoke' && deviceId(body.id)) {
    const { error } = await supabaseAdmin.from('tv_pairings').update({ revoked_at: new Date().toISOString() })
      .eq('owner_id', owner).eq('id', body.id).eq('scope', scope).is('revoked_at', null)
    return error ? reply({ error: 'unavailable' }, 503) : reply({ revoked: true })
  }
  if (!enabled()) return reply({ error: 'disabled' }, 404)
  const code = pairingCode(body?.code, 8)
  const qr = body?.qr
  if (!code || (qr !== undefined && (typeof qr !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(qr))))
    return reply({ error: 'invalid_request' }, 400)
  const codeDigest = shortCodeHash(code)
  if (!codeDigest) return reply({ error: 'unavailable' }, 503)
  const lookup = { p_owner_id: owner, p_code_hash: codeDigest, p_qr_hash: typeof qr === 'string' ? hash(qr) : null }
  if (body?.action === 'review') {
    const { data, error } = await supabaseAdmin.rpc('tv_review_qr_pairing', lookup).maybeSingle()
    if (error) return reply({ error: 'unavailable' }, 503)
    return data ? reply({ pairing: data }) : reply({ error: 'pairing_unavailable' }, 409)
  }
  if ((body?.action !== 'approve' && body?.action !== 'deny') || !deviceId(body.id))
    return reply({ error: 'invalid_request' }, 400)
  const { data, error } = await supabaseAdmin.rpc('tv_decide_qr_pairing', {
    ...lookup, p_id: body.id, p_approve: body.action === 'approve',
  })
  if (error) return reply({ error: 'unavailable' }, 503)
  return data ? reply({ accepted: true }) : reply({ error: 'pairing_unavailable' }, 409)
}
