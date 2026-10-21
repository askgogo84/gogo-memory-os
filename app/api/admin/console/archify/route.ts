import { NextResponse } from 'next/server'
import { requireAdminConsole } from '@/lib/admin/console-auth'

export const dynamic = 'force-dynamic'

// The Archify architecture map, served only to unlocked admins (it describes internal weak points).
export async function GET() {
  const gate = await requireAdminConsole('viewer')
  if (!gate.ok) return new NextResponse('Not available', { status: 404 })
  const { ARCHIFY_HTML } = await import('@/lib/admin/archify-html')
  return new NextResponse(ARCHIFY_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
    },
  })
}
