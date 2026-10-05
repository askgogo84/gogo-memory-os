import {NextResponse} from 'next/server'
import {getSession} from '@/lib/dashboard/session'
import {verifySameOrigin} from '@/lib/dashboard/guard'
import {supabaseAdmin} from '@/lib/supabase-admin'
import {takeControlOfCommerceRead} from '@/lib/agent/browser-command'

export const dynamic = 'force-dynamic'

// Recreate only the expired human browser for an existing owner-scoped read.
// This does not start another retailer comparison or perform provider actions.
export async function POST(request: Request, {params}: {params: Promise<{runId: string}>}) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked
  const session = await getSession()
  if (!session) return NextResponse.json({ok: false, error: 'unauthorized'}, {status: 401})
  const {runId} = await params
  const {data: user, error} = await supabaseAdmin.from('users')
    .select('id,telegram_id,whatsapp_id,name')
    .eq('telegram_id', Number(session.telegramId)).maybeSingle()
  if (error || !user?.id || !user.whatsapp_id) return NextResponse.json({ok: false, error: 'user_unavailable'}, {status: 400})
  try {
    await takeControlOfCommerceRead({actor: {
      userId: String(user.id), legacyTelegramId: Number(user.telegram_id),
      whatsappId: String(user.whatsapp_id), name: String(user.name || 'Gogo'),
    }, runId})
    return NextResponse.json({ok: true})
  } catch (cause) {
    const reason = String((cause as Error)?.message || 'browser_control_failed')
    console.error('DASHBOARD_BROWSER_HANDOFF_RESTORE_FAILED:', reason)
    return NextResponse.json({ok: false, error: reason}, {status: /unavailable|blocked|in_use/.test(reason) ? 409 : 500})
  }
}
