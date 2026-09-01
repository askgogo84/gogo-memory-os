import { NextRequest, NextResponse } from 'next/server'
import { resolveShortLinkToSignedUrl } from '@/lib/services/document-links'

// Per-request: resolves a token and mints a fresh signed URL every time. Never cache.
export const dynamic = 'force-dynamic'

/**
 * GET /f/<token> — branded original-file link.
 *
 * Resolves an opaque short-link token to a FRESH short-lived Supabase signed URL
 * and 302-redirects to it. Any miss / expired / revoked / unowned token collapses
 * to a generic 404 (no metadata leaked). The signed URL is generated per request
 * and never stored; the token encodes no user/document information.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const signedUrl = await resolveShortLinkToSignedUrl(token)
  if (!signedUrl) {
    return new NextResponse('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  const res = NextResponse.redirect(signedUrl, 302)
  res.headers.set('Cache-Control', 'no-store')
  return res
}
