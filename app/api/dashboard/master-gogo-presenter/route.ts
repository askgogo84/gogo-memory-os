const MASTER_GOGO_SOURCE = 'https://dnznrvs05pmza.cloudfront.net/kling-o3-pro/924560893566914607/Animate_this_exact_seated_Guide_Gogo_as_a_calm_teacher_speaking_directly_to_the_learner__Preserve_th.mp4?_jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJrZXlIYXNoIjoiOTNmOWI5ZDI3OGNkOTdmZiIsImJ1Y2tldCI6InJ1bndheS10YXNrLWFydGlmYWN0cyIsInN0YWdlIjoicHJvZCIsImV4cCI6MTc4ODk5NzU4Nn0.QyozeZycv6v_1ibZUKuj8MPxQAY9uO1Wn1i4AlOGiTs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const upstream = await fetch(MASTER_GOGO_SOURCE, { cache: 'no-store' })
    if (!upstream.ok || !upstream.body) {
      return new Response('Presenter unavailable', { status: 502 })
    }

    const headers = new Headers()
    headers.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4')
    const length = upstream.headers.get('content-length')
    if (length) headers.set('Content-Length', length)
    headers.set('Cache-Control', 'public, max-age=86400, s-maxage=31536000, stale-while-revalidate=31536000, stale-if-error=31536000')
    headers.set('Vercel-CDN-Cache-Control', 'public, s-maxage=31536000, stale-while-revalidate=31536000')
    headers.set('Content-Disposition', 'inline; filename="master-gogo-presenter.mp4"')

    return new Response(upstream.body, { status: 200, headers })
  } catch {
    return new Response('Presenter unavailable', { status: 502 })
  }
}
