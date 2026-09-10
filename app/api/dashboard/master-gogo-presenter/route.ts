import { supabaseAdmin } from '@/lib/data/supabase-admin'

const BUCKET = process.env.SUPABASE_DOCUMENT_BUCKET || 'user-documents'
const STORAGE_PATH = '_system/learn/master-gogo-presenter.mp4'
const MASTER_GOGO_SOURCE = 'https://dnznrvs05pmza.cloudfront.net/kling-o3-pro/924560893566914607/Animate_this_exact_seated_Guide_Gogo_as_a_calm_teacher_speaking_directly_to_the_learner__Preserve_th.mp4?_jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJrZXlIYXNoIjoiOTNmOWI5ZDI3OGNkOTdmZiIsImJ1Y2tldCI6InJ1bndheS10YXNrLWFydGlmYWN0cyIsInN0YWdlIjoicHJvZCIsImV4cCI6MTc4ODk5NzU4Nn0.QyozeZycv6v_1ibZUKuj8MPxQAY9uO1Wn1i4AlOGiTs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function videoResponse(bytes: Uint8Array, source: 'storage' | 'seeded') {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'public, max-age=86400, s-maxage=31536000, stale-while-revalidate=31536000',
      'Content-Disposition': 'inline; filename="master-gogo-presenter.mp4"',
      'X-AskGogo-Video-Source': source,
    },
  })
}

export async function GET(request: Request) {
  const probe = new URL(request.url).searchParams.get('probe') === '1'

  try {
    const { data: stored } = await supabaseAdmin.storage.from(BUCKET).download(STORAGE_PATH)
    if (stored) {
      const storedBytes = new Uint8Array(await stored.arrayBuffer())
      if (storedBytes.byteLength) {
        if (probe) {
          return Response.json({
            ok: true,
            source: 'storage',
            contentType: 'video/mp4',
            contentLength: storedBytes.byteLength,
          })
        }
        return videoResponse(storedBytes, 'storage')
      }
    }

    const upstream = await fetch(MASTER_GOGO_SOURCE, { cache: 'no-store' })
    if (!upstream.ok) {
      console.error('Master Gogo presenter source failed:', upstream.status)
      return probe
        ? Response.json({ ok: false, source: 'upstream', status: upstream.status }, { status: 502 })
        : new Response('Presenter unavailable', { status: 502 })
    }

    const bytes = new Uint8Array(await upstream.arrayBuffer())
    if (!bytes.byteLength) {
      return probe
        ? Response.json({ ok: false, source: 'upstream', status: upstream.status, contentLength: 0 }, { status: 502 })
        : new Response('Presenter unavailable', { status: 502 })
    }

    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(
      STORAGE_PATH,
      bytes,
      { contentType: 'video/mp4', upsert: true, cacheControl: '31536000' },
    )
    if (uploadError) console.error('Master Gogo presenter storage seed failed:', uploadError.message)

    if (probe) {
      return Response.json({
        ok: true,
        source: 'seeded',
        contentType: upstream.headers.get('content-type') || 'video/mp4',
        contentLength: bytes.byteLength,
      })
    }

    return videoResponse(bytes, 'seeded')
  } catch (error) {
    console.error('Master Gogo presenter failed:', error)
    return probe
      ? Response.json({ ok: false, source: 'error' }, { status: 502 })
      : new Response('Presenter unavailable', { status: 502 })
  }
}
