import { NextRequest, NextResponse } from 'next/server'
import { searchWeb } from '@/lib/web-search'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
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
