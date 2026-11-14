import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { boundedBody, enabled, jsonBody, reply, scope, tokenHash } from '@/lib/tv/protocol'

export const maxDuration = 45

async function activePairing(proof: string, now: string) {
  return supabaseAdmin.from('tv_pairings').select('owner_id').eq('token_hash', proof)
    .eq('scope', scope).is('revoked_at', null).not('approved_at', 'is', null).gt('expires_at', now).maybeSingle()
}

export async function POST(request: Request) {
  if (!enabled()) return reply({ error: 'disabled' }, 404)
  const proof = tokenHash(request)
  if (!proof) return reply({ error: 'unauthorized' }, 401)
  try {
    const now = new Date()
    const { data: pairing, error } = await supabaseAdmin.from('tv_pairings')
      .update({ next_request_at: new Date(now.getTime() + 10_000).toISOString() })
      .eq('token_hash', proof).eq('scope', scope).is('revoked_at', null).not('approved_at', 'is', null)
      .gt('expires_at', now.toISOString()).lte('next_request_at', now.toISOString())
      .select('owner_id').maybeSingle()
    if (error) return reply({ error: 'unavailable' }, 503)
    if (!pairing?.owner_id) {
      const current = await activePairing(proof, now.toISOString())
      if (current.error) return reply({ error: 'unavailable' }, 503)
      return current.data ? reply({ error: 'rate_limited' }, 429) : reply({ error: 'unauthorized' }, 401)
    }
    const { data: owner, error: ownerError } = await supabaseAdmin.from('users')
      .select('telegram_id,whatsapp_id,access_status,name').eq('id', pairing.owner_id).maybeSingle()
    if (ownerError) return reply({ error: 'unavailable' }, 503)
    const ownerNumber = Number(owner?.telegram_id)
    if (!owner?.whatsapp_id || ![null, 'active'].includes(owner.access_status) || !Number.isSafeInteger(ownerNumber) ||
        !ownerNumber || String(ownerNumber) !== String(owner.telegram_id)) return reply({ error: 'unauthorized' }, 401)

    let result: Record<string, string>
    if (request.headers.get('content-type') === 'audio/wav') {
      const wav = await boundedBody(request, 640_044)
      if (!wav || !isPcmVoice(wav)) return reply({ error: 'invalid_audio' }, 400)
      const { transcribeTvVoice } = await import('@/lib/services/voice-transcription')
      result = { transcript: redactSecretShapedText(await transcribeTvVoice(wav)).slice(0, 1000) }
    } else {
      const body = await jsonBody(request)
      const text = typeof body?.text === 'string' ? body.text.trim() : ''
      if (!text || text.length > 1000) return reply({ error: 'invalid_question' }, 400)
      const { answerTvQuestion } = await import('@/lib/tv/answer')
      result = { text: await answerTvQuestion(String(owner.telegram_id), owner.name, text) }
    }
    // Suppress the result if the owner revoked the credential during a provider call.
    const current = await activePairing(proof, new Date().toISOString())
    if (current.error) return reply({ error: 'unavailable' }, 503)
    if (current.data?.owner_id !== pairing.owner_id) return reply({ error: 'unauthorized' }, 401)
    return reply(result)
  } catch {
    return reply({ error: 'unavailable' }, 503)
  }
}

function isPcmVoice(bytes: Uint8Array) {
  if (bytes.length < 3244) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  return tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(12) === 'fmt ' && tag(36) === 'data' &&
    view.getUint32(4, true) === bytes.length - 8 && view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1 && view.getUint32(24, true) === 16000 &&
    view.getUint32(28, true) === 32000 && view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16 &&
    view.getUint32(40, true) === bytes.length - 44 && bytes.length % 2 === 0
}
