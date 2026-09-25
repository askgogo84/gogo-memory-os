import { deliveryRpc } from './reminder-delivery'

export function deliveryCallbackUrl(base: string, token?: string, chunk = 1, chunks = 1): string {
  if (!token) return base
  if (!base) throw new Error('delivery_callback_url_required')
  const url = new URL(base)
  url.searchParams.set('delivery_token', token)
  url.searchParams.set('chunk', String(chunk))
  url.searchParams.set('chunks', String(chunks))
  return url.toString()
}

export async function persistAcceptedChunk(sid: string, token: string | undefined, chunk: number, chunks: number) {
  if (!token) return
  try {
    await deliveryRpc('record_delivery_receipt', { p_sid: sid, p_status: 'accepted', p_verified: false,
      p_token: token, p_chunk: chunk, p_chunks: chunks })
    await deliveryRpc('reconcile_delivery_receipt', { p_sid: sid })
  } catch (cause) {
    // Provider already accepted: never classify a persistence exception as rejection.
    throw Object.assign(new Error('accepted_chunk_persistence_failed', { cause }), { partialSend: true })
  }
}
