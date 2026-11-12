import { supabaseAdmin } from '@/lib/supabase-admin'
import { enabled, hash, newCode, newToken, reply, scope, sourceHash, tokenHash } from '@/lib/tv/protocol'

export async function POST(request: Request) {
  if (!enabled()) return reply({ error: 'disabled' }, 404)
  if (request.headers.get('x-gogo-tv') !== '1') return reply({ error: 'invalid_request' }, 400)
  const source = sourceHash(request)
  if (!source) return reply({ error: 'pairing_unavailable' }, 503)
  const code = newCode()
  const token = newToken()
  const { data, error } = await supabaseAdmin.rpc('tv_start_pairing', {
    p_source_hash: source, p_code_hash: hash(code), p_token_hash: hash(token),
  })
  if (error) return reply({ error: 'pairing_unavailable' }, 503)
  if (!data) return reply({ error: 'rate_limited' }, 429)
  return reply({ code, token, pairSeconds: 600 }, 201)
}

export async function GET(request: Request) {
  if (!enabled()) return reply({ error: 'disabled' }, 404)
  const proof = tokenHash(request)
  if (!proof) return reply({ error: 'unauthorized' }, 401)
  const { data, error } = await supabaseAdmin.from('tv_pairings')
    .select('approved_at,pair_expires_at,expires_at').eq('token_hash', proof)
    .eq('scope', scope).is('revoked_at', null).maybeSingle()
  if (error) return reply({ error: 'pairing_unavailable' }, 503)
  if (data?.approved_at && Date.parse(data.expires_at) > Date.now()) return reply({ state: 'paired' })
  if (data && !data.approved_at && Date.parse(data.pair_expires_at) > Date.now()) return reply({ state: 'pending' })
  return reply({ error: 'unauthorized' }, 401)
}

export async function DELETE(request: Request) {
  // Revocation stays available after switching off new pairing and AskGogo.
  const proof = tokenHash(request)
  if (!proof) return reply({ error: 'unauthorized' }, 401)
  const { error } = await supabaseAdmin.from('tv_pairings').update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', proof).eq('scope', scope).is('revoked_at', null)
  return error ? reply({ error: 'revocation_unavailable' }, 503) : reply({ revoked: true })
}
