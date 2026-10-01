import {NextResponse} from 'next/server'
import {cookies} from 'next/headers'
import {isAgentSession, requireAgentMutationOrigin, requireAgentSession} from '@/lib/agent/session'
import {encryptVaultValue, hasVaultMasterKey} from '@/lib/security/vault-crypto'
import {commerceEnabled, commerceOrigin, commerceProvider} from '@/lib/commerce/providers'
import {newCommerceFlow, registerCommerceClient, commerceAuthorizeUrl} from '@/lib/commerce/oauth'

import {readCommerceTask, resumeCommerceTaskAfterAuth} from '@/lib/commerce/task'
import {readCommerceConnection} from '@/lib/commerce/connection-store'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: {params: Promise<{provider: string}>}) {
  const blocked = requireAgentMutationOrigin(request)
  if (blocked) return blocked
  const session = await requireAgentSession(request)
  if (!isAgentSession(session)) return session
  // Initial OAuth handoff uses the authenticated dashboard browser, not a native bearer session.
  if (session.surface !== 'web') return NextResponse.json({error: 'open_dashboard_to_connect'}, {status: 400})
  const provider = commerceProvider((await context.params).provider)
  if (!provider) return NextResponse.json({error: 'unknown_provider'}, {status: 404})
  if (!commerceEnabled(provider)) return NextResponse.json({error: 'provider_approval_required'}, {status: 409})
  if (!hasVaultMasterKey()) return NextResponse.json({error: 'secure_storage_unavailable'}, {status: 503})
  try {
    const body = await request.text()
    const runId = body ? JSON.parse(body).runId : undefined
    if (runId !== undefined && (typeof runId !== 'string' || !(await readCommerceTask(session.telegramId, runId)))) {
      return NextResponse.json({error: 'task_unavailable'}, {status: 404})
    }
    // Current task adapter is restaurant food; Zepto grocery needs a separate basket task.
    if (runId && provider !== 'swiggy') return NextResponse.json({error: 'task_provider_not_supported'}, {status: 409})
    if (runId && await readCommerceConnection(session.telegramId, provider)) {
      const task = await resumeCommerceTaskAfterAuth(session.telegramId, runId, provider)
      if (!task) return NextResponse.json({error: 'task_unavailable'}, {status: 409})
      return NextResponse.json({taskContinued: true}, {headers: {'Cache-Control': 'no-store'}})
    }
    const clientId = await registerCommerceClient(provider)
    const flow = newCommerceFlow(provider, session.telegramId, clientId)
    if (runId) flow.runId = runId
    const jar = await cookies()
    jar.set(`commerce_oauth_${provider}`, encryptVaultValue(JSON.stringify(flow)), {
      httpOnly: true, secure: commerceOrigin().startsWith('https:'), sameSite: 'lax', path: `/api/commerce/${provider}`, maxAge: 600,
    })
    return NextResponse.json({authorizationUrl: commerceAuthorizeUrl(flow)}, {headers: {'Cache-Control': 'no-store'}})
  } catch {
    return NextResponse.json({error: 'provider_connection_unavailable'}, {status: 502})
  }
}
