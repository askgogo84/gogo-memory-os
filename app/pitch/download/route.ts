const PPTX_URL = 'https://qenhjcooyecmatwducpu.supabase.co/storage/v1/object/public/pitch-assets/askgogo-2026/AskGogo_Investor_Deck.pptx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const upstream = await fetch(PPTX_URL, { cache: 'no-store' })
  if (!upstream.ok || !upstream.body) {
    return new Response(`Pitch PPT unavailable (${upstream.status})`, { status: 502 })
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="AskGogo-Pitch-Deck-v3.pptx"',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
