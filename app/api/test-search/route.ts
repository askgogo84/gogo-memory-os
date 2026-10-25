import { NextRequest, NextResponse } from 'next/server'
import { searchWeb } from '@/lib/web-search'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  // This route spends search quota and is only for local development.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const q = url.searchParams.get('q') || 'gold price today in india'

  try {
    const result = await searchWeb(q)

    return NextResponse.json({
      ok: true,
      query: q,
      hasTavilyKey: !!process.env.TAVILY_API_KEY,
      hasResult: !!result.trim(),
      result,
    })
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        query: q,
        hasTavilyKey: !!process.env.TAVILY_API_KEY,
        error: error?.message || 'Unknown error',
      },
      { status: 500 }
    )
  }
}
