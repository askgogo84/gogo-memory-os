
import { supabaseAdmin } from '@/lib/supabase-admin'
import { enabled, hash, jsonBody, newCode, newQrCode, newPollProof, pollHash, reply, scope, shortCodeHash, sourceHash, tokenHash } from '@/lib/tv/protocol'

export async function POST(request: Request) {
  if (!enabled()) return reply({ error: 'disabled' }, 404)
  if (request.headers.get('x-gogo-tv') !== '2') return reply({ error: 'update_required' }, 426)
  const source = sourceHash(request)
  if (!source) return reply({ error: 'pairing_unavailable' }, 503)
  const body = await jsonBody(request)
  const sessionHash = body?.sessionHash
  const name = typeof body?.deviceName === 'string' ? body.deviceName.trim() : ''
  if (typeof sessionHash !== 'string' || !/^[a-f0-9]{64}$/.test(sessionHash))
    return reply({ error: 'invalid_request' }, 400)
  const deviceName = /^[\p{L}\p{N} ._()-]{1,48}$/u.test(name) ? name : 'Android TV'
  const code = newCode(8)
  const codeDigest = shortCodeHash(code)
  if (!codeDigest) return reply({ error: 'pairing_unavailable' }, 503)
  const qr = newQrCode()
  const proof = newPollProof()
  const { data, error } = await supabaseAdmin.rpc('tv_start_qr_pairing', {
    p_source_hash: source, p_code_hash: codeDigest, p_token_hash: sessionHash,
    p_qr_hash: hash(qr), p_poll_hash: hash(proof), p_device_name: deviceName,
  })
  if (error) return reply({ error: 'pairing_unavailable' }, 503)
  if (!data) return reply({ error: 'rate_limited' }, 429)
  return reply({ code, qr, proof, pairSeconds: 300, interval: 4 }, 201)
}

export async function PUT(request: Request) {
  if (!enabled()) return reply({ error: 'disabled' }, 404)
  const proof = pollHash(request)
  if (!proof) return reply({ error: 'unauthorized' }, 401)
  const { data, error } = await supabaseAdmin.rpc('tv_poll_qr_pairing', { p_poll_hash: proof })
  if (error) return reply({ error: 'pairing_unavailable' }, 503)
  if (data === 'invalid') return reply({ error: 'unauthorized' }, 401)
  if (data === 'slow_down') return reply({ error: 'rate_limited' }, 429)
  return reply({ state: data })
}

export async function DELETE(request: Request) {
  const proof = tokenHash(request)
  if (!proof) return reply({ error: 'unauthorized' }, 401)
  const { error } = await supabaseAdmin.from('tv_pairings').update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', proof).eq('scope', scope).is('revoked_at', null)
  return error ? reply({ error: 'revocation_unavailable' }, 503) : reply({ revoked: true })
}
