import { buildPitchPptx } from '@/lib/pitch/pptx-v3'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET() {
  const pptx = await buildPitchPptx()
  return new Response(new Uint8Array(pptx), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="AskGogo-Pitch-Deck-v3.pptx"',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
