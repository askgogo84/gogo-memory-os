const DECK_URL = 'https://qenhjcooyecmatwducpu.supabase.co/storage/v1/object/public/pitch-assets/askgogo-2026/AskGogo-Pitch-Deck.html'

export const dynamic = 'force-dynamic'

export async function GET() {
  const upstream = await fetch(DECK_URL, { cache: 'no-store' })
  if (!upstream.ok) {
    return new Response(`Pitch deck unavailable (${upstream.status})`, { status: 502 })
  }

  const html = await upstream.text()

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: https:; style-src 'self' 'unsafe-inline' data: blob: https:; img-src 'self' data: blob: https:; font-src 'self' data: blob: https:; connect-src 'self' data: blob: https:; frame-src 'self' data: blob: https:; media-src 'self' data: blob: https:; object-src 'none'; base-uri 'none'",
    },
  })
}
