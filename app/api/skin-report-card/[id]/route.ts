import { NextRequest, NextResponse } from 'next/server'
import { buildSkinReportCardSvg, getSkinCheckReportById } from '@/lib/bot/services/skin-check-report-card'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const report = await getSkinCheckReportById(id)

    if (!report) {
      return new NextResponse('Skin report not found', { status: 404 })
    }

    const svg = buildSkinReportCardSvg(report)

    return new NextResponse(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
      },
    })
  } catch (error: any) {
    console.error('[skin-report-card] route failed:', error?.message || error)
    return new NextResponse('Skin report failed to render', { status: 500 })
  }
}
