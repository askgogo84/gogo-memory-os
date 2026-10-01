import {NextResponse} from 'next/server'
import {cookies} from 'next/headers'
import {getSession} from '@/lib/dashboard/session'
import {decryptVaultValue} from '@/lib/security/vault-crypto'
import {commerceEnabled, commerceOrigin, commerceProvider} from '@/lib/commerce/providers'
import {exchangeCommerceCode, validateCommerceCallback, type CommerceAuthFlow} from '@/lib/commerce/oauth'
import {saveCommerceConnection} from '@/lib/commerce/connection-store'

import {resumeCommerceTaskAfterAuth} from '@/lib/commerce/task'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, context: {params: Promise<{provider: string}>}) {
  const provider = commerceProvider((await context.params).provider)
  if (!provider) return NextResponse.json({error: 'unknown_provider'}, {status: 404})
  const session = await getSession()
  if (!session) return NextResponse.json({error: 'sign_in_and_reconnect'}, {status: 401, headers: {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}})
  const jar = await cookies()
  const cookieName = `commerce_oauth_${provider}`
  const stored = jar.get(cookieName)?.value
  jar.set(cookieName, '', {path: `/api/commerce/${provider}`, maxAge: 0, httpOnly: true, secure: commerceOrigin().startsWith('https:'), sameSite: 'lax'})
  let outcome = 'connection_failed'
  let runId: string | undefined
  try {
    if (!commerceEnabled(provider) || !stored) throw new Error('commerce_auth_unavailable')
    const flow = JSON.parse(decryptVaultValue(stored)) as CommerceAuthFlow
    const url = new URL(request.url)
    validateCommerceCallback(flow, provider, String(session.telegramId), url.searchParams.get('state') || '', url.searchParams.get('iss'))
    if (url.searchParams.has('error')) throw new Error('commerce_auth_declined')
    const token = await exchangeCommerceCode(flow, url.searchParams.get('code') || '')
    await saveCommerceConnection(String(session.telegramId), provider, token)
    outcome = 'authorized'
    if (flow.runId) {
      runId = flow.runId
      // Connection can succeed even when the original task closed during sign-in.
      outcome = 'authorized_task_unavailable'
      if (await resumeCommerceTaskAfterAuth(String(session.telegramId), flow.runId, provider)) outcome = 'authorized'
    }
  } catch { /* Never return provider errors, tokens or authorization codes to the UI. */ }
  const redirect = new URL('/dashboard/commerce', commerceOrigin())
  redirect.search = new URLSearchParams({provider, result: outcome, ...(runId ? {run: runId} : {})}).toString()
  return NextResponse.redirect(redirect.href, {
    status: 303, headers: {'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'},
  })
}
