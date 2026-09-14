import { renderPitchDeckHtml } from '@/lib/pitch/deck-v3'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  return new Response(renderPitchDeckHtml(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'",
    },
  })
}
