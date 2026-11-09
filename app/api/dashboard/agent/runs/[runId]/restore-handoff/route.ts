import {NextResponse} from 'next/server'
import {getSession} from '@/lib/dashboard/session'
import {verifySameOrigin} from '@/lib/dashboard/guard'
import {supabaseAdmin} from '@/lib/supabase-admin'
import {restoreReadBrowserHandoff} from '@/lib/agent/browser-command'
import {browserRunOwnerFromSession,browserRunOwnerMatchesRow} from '@/lib/dashboard/browser-run-owner'

export const dynamic = 'force-dynamic'

// Recreate only an expired human browser for an existing owner-scoped read.
// This does not start another task or perform provider actions.
export async function POST(request: Request, {params}: {params: Promise<{runId: string}>}) {
  const blocked = verifySameOrigin(request)
  if (blocked) return blocked
  const session = await getSession()
  if (!session) return NextResponse.json({ok: false, error: 'unauthorized'}, {status: 401})
  // Never permit lossy BIGINT -> Number coercion to pick another owner's browser actor.
  const owner = browserRunOwnerFromSession(session.telegramId)
  if (!owner) return NextResponse.json({ok: false, error: 'owner_unavailable'}, {status: 403})
  const {runId} = await params
  const {data: user, error} = await supabaseAdmin.from('users')
    .select('id,telegram_id,whatsapp_id,name')
    .eq('telegram_id', owner.telegramId).maybeSingle()
  if (error || !user?.id || !user.whatsapp_id || !browserRunOwnerMatchesRow(user.telegram_id, owner)) return NextResponse.json({ok: false, error: 'user_unavailable'}, {status: 400})
  try {
    await restoreReadBrowserHandoff({actor: {
      userId: String(user.id), legacyTelegramId: owner.legacyTelegramId,
      whatsappId: String(user.whatsapp_id), name: String(user.name || 'Gogo'),
    }, runId})
    return NextResponse.json({ok: true})
  } catch (cause) {
    const reason = String((cause as Error)?.message || 'browser_control_failed')
    console.error('DASHBOARD_BROWSER_HANDOFF_RESTORE_FAILED:', reason)
    return NextResponse.json({ok: false, error: reason}, {status: /unavailable|blocked|in_use/.test(reason) ? 409 : 500})
  }
}
