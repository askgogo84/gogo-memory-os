import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const AUDIO_SOURCES: Record<string, string> = {
  'meet-gogo': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/0e7ef01f-fbf6-48fc-98ab-6ba94f4539bd.mp3',
  'first-reminder': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/cac41bed-d44b-44b3-8708-234f8cb6bffa.mp3',
  'save-something': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/69635c40-98ae-47ad-82dd-531d34fdf456.mp3',
  'find-it-again': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/0984379c-a0db-412e-ab9e-edae841e2a29.mp3',
  'voice-notes': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/fbd53bbc-6a2c-4c8c-a26f-0c86da5a5ae8.mp3',
  'recurring-reminders': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/84c14e84-3820-4bfc-9415-864019925898.mp3',
  'lists-tasks': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/8b4ad900-3414-48fd-853b-38c19994cca7.mp3',
  'screenshots-links': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/8f1c5081-b52e-43f1-bd2a-3ab3de96cf03.mp3',
  calendar: 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/050ef327-ca85-4326-8440-9bb5d2ebeecc.mp3',
  'plan-your-day': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/f845ab88-d1d4-4958-9213-fffc466c3c7e.mp3',
  'daily-brief': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/2e381267-85e8-401a-b123-98df2fed276a.mp3',
  'meeting-recorder': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/f98d7123-5df8-46ec-9394-be3af39cf4db.mp3',
  travel: 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/a80d089a-2bcb-4148-84d8-dc70dab465f4.mp3',
  'personalize-gogo': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/d0284788-6d17-4932-bf38-3e88a07628ce.mp3',
  breathing: 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/59ad49c0-e4e1-4dd5-8add-7c7e159fb0f7.mp3',
  'memory-search': 'https://storage.googleapis.com/adm--audio-playback--7d--public/mcp-preview/0fe64342-09c6-450f-ac62-eacd7c297ab4.mp3',
}

export async function GET(req: NextRequest) {
  const key = String(req.nextUrl.searchParams.get('key') || '').trim()
  const source = AUDIO_SOURCES[key]
  if (!source) return NextResponse.json({ error: 'invalid_lesson' }, { status: 404 })

  try {
    const upstream = await fetch(source, { cache: 'no-store' })
    const contentType = upstream.headers.get('content-type') || ''
    const contentLength = upstream.headers.get('content-length') || null

    if (req.nextUrl.searchParams.get('probe') === '1') {
      return NextResponse.json({
        ok: upstream.ok,
        status: upstream.status,
        contentType,
        contentLength,
      }, { status: upstream.ok ? 200 : 502 })
    }

    if (!upstream.ok) {
      return NextResponse.json({ error: 'audio_unavailable', upstreamStatus: upstream.status }, { status: 502 })
    }

    const body = await upstream.arrayBuffer()
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'audio/mpeg',
        'Content-Length': String(body.byteLength),
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
        'Accept-Ranges': 'none',
      },
    })
  } catch (error) {
    console.error('[lesson-audio] proxy failed', key, error)
    return NextResponse.json({ error: 'audio_proxy_failed' }, { status: 502 })
  }
}
