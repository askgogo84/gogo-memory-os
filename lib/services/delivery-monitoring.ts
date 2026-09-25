import { NextResponse } from 'next/server'
import { deliveryRpc } from './reminder-delivery'

// Call only after cron authorization. A run row survives process death, so an
// unfinished invocation remains observable without inventing a successful beat.
export async function withDeliveryHeartbeat(source: string, run: () => Promise<Response>): Promise<Response> {
  let id: string
  try { id = await deliveryRpc('start_delivery_worker', { p_source: source }) }
  catch { return NextResponse.json({ ok: false, error: 'heartbeat_start_failed' }, { status: 503 }) }
  let response: Response
  try { response = await run() }
  catch { response = NextResponse.json({ ok: false, error: 'delivery_worker_failed' }, { status: 503 }) }
  try {
    if (!await deliveryRpc('finish_delivery_worker', { p_id: id, p_ok: response.ok, p_status: response.status })) throw Error('missing_run')
  } catch { return NextResponse.json({ ok: false, error: 'heartbeat_finish_failed' }, { status: 503 }) }
  return response
}
