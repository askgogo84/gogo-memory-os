import { NextRequest, NextResponse } from 'next/server'
import {
  buildSkinReportCardImageResponse,
  buildSkinReportCardSafeFallbackImageResponse,
  getSkinCheckReportById,
} from '@/lib/bot/services/skin-check-report-card'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params
  const report = await getSkinCheckReportById(id)

  if (!report) {
    return new NextResponse('Skin report not found', { status: 404 })
  }

  try {
    const response = await buildSkinReportCardImageResponse(report)
    response.headers.set('Content-Type', 'image/png')
    response.headers.set('Cache-Control', 'public, max-age=3600')
    return response
  } catch (error: any) {
    console.error('[skin-report-card] premium render failed:', error?.message || error)

    const fallback = await buildSkinReportCardSafeFallbackImageResponse(report)
    fallback.headers.set('Content-Type', 'image/png')
    fallback.headers.set('Cache-Control', 'public, max-age=3600')
    return fallback
  }
}