import { NextResponse } from 'next/server'
import { getSession } from '@/lib/dashboard/session'
import { verifySameOrigin } from '@/lib/dashboard/guard'
import { resolveMobileActor } from '@/lib/mobile-auth/session'

export type AgentSession = {
  telegramId: string
  userId?: string
  whatsappId?: string
  surface: 'web' | 'ios' | 'android'
}

export async function requireAgentSession(request?: Request): Promise<AgentSession | NextResponse> {
  if (request?.headers.get('authorization')) {
    const mobile = await resolveMobileActor(request)
    if (!mobile) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    return {
      telegramId: String(mobile.legacyTelegramId),
      userId: mobile.userId,
      whatsappId: mobile.whatsappId,
      surface: mobile.platform,
    }
  }

  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const telegramId = String(session.telegramId || '').trim()
  if (!telegramId) return NextResponse.json({ error: 'invalid_session' }, { status: 400 })
  return { telegramId, surface: 'web' }
}

/**
 * Browser mutations retain same-origin CSRF protection. Native mutations are
 * authenticated with an opaque bearer token and therefore do not rely on an
 * Origin header that a native client cannot provide consistently.
 */
export function requireAgentMutationOrigin(request: Request): NextResponse | null {
  if (request.headers.get('authorization')) return null
  return verifySameOrigin(request)
}

export function isAgentSession(value: AgentSession | NextResponse): value is AgentSession {
  return !(value instanceof NextResponse)
}
