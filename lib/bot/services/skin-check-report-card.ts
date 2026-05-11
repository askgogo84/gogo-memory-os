import React from 'react'
import { ImageResponse } from 'next/og'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getLatestSkinChecks } from '@/lib/bot/services/skin-check-storage'

export function isSkinReportCardCommand(text: string) {
  const lower = (text || '')
    .toLowerCase()
    .replace(/[*_~`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const compact = lower.replace(/\s+/g, '')

  return (
    lower.includes('skin report card') ||
    lower.includes('create skin report card') ||
    lower.includes('generate skin report card') ||
    lower.includes('visual skin report') ||
    lower.includes('share skin report') ||
    compact.includes('skinreportcard') ||
    compact.includes('createskinreportcard') ||
    compact.includes('generateskinreportcard') ||
    compact.includes('visualskinreport')
  )
}

function clean(value: any, fallback = '-') {
  const output = String(value ?? '').replace(/\s+/g, ' ').trim()
  return output || fallback
}

function short(value: any, max = 42, fallback = '-') {
  const output = clean(value, fallback)
  return output.length > max ? `${output.slice(0, max - 1).trim()}...` : output
}

function score(report: any, key: string, fallback: string | number = '-') {
  return report?.scores_json?.[key] ?? fallback
}

function scorePercent(value: any, fallback = 65) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, parsed))
}

function list(items: any[], limit: number, fallback: string[] = []) {
  const values = (items || [])
    .map((item) => clean(item, ''))
    .filter(Boolean)
    .slice(0, limit)
  return values.length ? values : fallback.slice(0, limit)
}

function box(children: React.ReactNode, style: React.CSSProperties) {
  return React.createElement('div', { style }, children)
}

function Txt(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return React.createElement('div', { style: props.style }, props.children)
}

export async function getSkinCheckReportById(id: string) {
  const { data, error } = await supabaseAdmin
    .from('skin_check_reports')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    console.error('[skin-report-card] fetch failed:', error.message)
    return null
  }

  return data
}

export async function buildSkinReportCardImageResponse(report: any) {
  return buildSkinReportCardSafeFallbackImageResponse(report)
}

export async function buildSkinReportCardSafeFallbackImageResponse(report: any) {
  const hydration = score(report, 'hydration', 70)
  const barrier = score(report, 'barrier_support', 65)
  const oiliness = short(score(report, 'oiliness', 'moderate'), 18)
  const texture = short(score(report, 'texture', 'smooth'), 18)
  const skinType = short(report.skin_type || 'Combination', 22)

  const observations = list(report.observations_json || [], 4, [
    'T-zone shine visible',
    'Mild under-eye darkness',
    'Even overall tone',
    'Skin barrier appears stable',
  ])

  const am = list(report.am_routine_json || [], 3, [
    'Gentle cleanser',
    'Lightweight moisturizer',
    'SPF 50 sunscreen',
  ])

  const pm = list(report.pm_routine_json || [], 3, [
    'Gentle cleanser',
    'Niacinamide serum',
    'Lightweight moisturizer',
  ])

  const cautions = list(report.cautions_json || [], 3, [
    'Avoid harsh exfoliation',
    'Avoid skipping sunscreen',
    'Avoid heavy pore-clogging creams',
  ])

  const dateLabel = report?.created_at
    ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
    : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  const panelStyle: React.CSSProperties = {
    borderRadius: 28,
    background: '#f2e4c7',
    padding: 30,
    display: 'flex',
    flexDirection: 'column',
  }

  const titleStyle: React.CSSProperties = {
    color: '#173a31',
    fontSize: 24,
    fontWeight: 900,
  }

  const lineStyle: React.CSSProperties = {
    marginTop: 12,
    color: '#173a31',
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.25,
  }

  const element = box(
    [
      box(null, {
        position: 'absolute',
        inset: 0,
        background: 'linear-gradient(135deg, #071d18 0%, #102620 52%, #050908 100%)',
      }),
      Txt({
        children: 'ASKGOGO SKIN CHECK',
        style: {
          position: 'absolute',
          top: 56,
          left: 60,
          color: '#e7d4b0',
          fontSize: 40,
          fontWeight: 800,
          letterSpacing: 2,
        },
      }),
      Txt({
        children: 'VISUAL SKIN ANALYSIS',
        style: {
          position: 'absolute',
          top: 105,
          left: 62,
          color: '#bfae8a',
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 4,
        },
      }),
      Txt({
        children: dateLabel,
        style: {
          position: 'absolute',
          top: 62,
          right: 64,
          color: '#d7c29a',
          fontSize: 20,
          fontWeight: 700,
        },
      }),
      box(
        [
          Txt({ children: 'AT A GLANCE', style: titleStyle }),
          Txt({ children: `Skin Type: ${skinType}`, style: lineStyle }),
          Txt({ children: `Hydration: ${scorePercent(hydration, 70)} / 100`, style: lineStyle }),
          Txt({ children: `Barrier Support: ${scorePercent(barrier, 65)} / 100`, style: lineStyle }),
          Txt({ children: `Oiliness: ${oiliness}`, style: lineStyle }),
          Txt({ children: `Texture: ${texture}`, style: lineStyle }),
        ],
        { ...panelStyle, position: 'absolute', top: 170, left: 60, width: 450, height: 320 }
      ),
      box(
        [
          Txt({ children: 'KEY OBSERVATIONS', style: titleStyle }),
          ...observations.map((item) => Txt({ children: `- ${item}`, style: lineStyle })),
        ],
        { ...panelStyle, position: 'absolute', top: 170, right: 60, width: 510, height: 320 }
      ),
      box(
        [
          Txt({ children: 'AM ROUTINE', style: titleStyle }),
          ...am.map((item, i) => Txt({ children: `${i + 1}. ${item}`, style: lineStyle })),
        ],
        { ...panelStyle, position: 'absolute', top: 540, left: 60, width: 450, height: 280 }
      ),
      box(
        [
          Txt({ children: 'PM ROUTINE', style: titleStyle }),
          ...pm.map((item, i) => Txt({ children: `${i + 1}. ${item}`, style: lineStyle })),
        ],
        { ...panelStyle, position: 'absolute', top: 540, right: 60, width: 510, height: 280 }
      ),
      box(
        [
          Txt({ children: 'AVOID THIS WEEK', style: titleStyle }),
          ...cautions.map((item) => Txt({ children: `- ${item}`, style: lineStyle })),
        ],
        { ...panelStyle, position: 'absolute', top: 870, left: 60, right: 60, height: 210 }
      ),
      Txt({
        children: 'Not medical advice. For painful acne, infection, irritation, rashes, or changing moles, consult a dermatologist.',
        style: {
          position: 'absolute',
          left: 60,
          right: 60,
          bottom: 60,
          color: '#c7b28d',
          fontSize: 16,
          fontWeight: 600,
          textAlign: 'center',
        },
      }),
    ],
    {
      display: 'flex',
      position: 'relative',
      width: '100%',
      height: '100%',
      fontFamily: 'Arial, sans-serif',
      overflow: 'hidden',
    }
  )

  return new ImageResponse(element, {
    width: 1080,
    height: 1350,
  })
}

export async function buildSkinReportCardReply(telegramId?: number) {
  if (!telegramId) {
    return `Skin Report Card\n\nRun skin check first, then say create skin report card.`
  }

  const [latest] = await getLatestSkinChecks(telegramId, 1)
  if (!latest) {
    return `Skin Report Card\n\nNo skin check found yet. Send a clear selfie and type skin check first.`
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'
  const mediaUrl = `${appUrl}/api/skin-report-card/${latest.id}`

  return {
    text:
      `Skin Report Card ready\n\n` +
      `I created your visual Skin Check card.\n\n` +
      `Open card:\n${mediaUrl}\n\n` +
      `Tip: take your next selfie in similar lighting for cleaner progress tracking.`,
    mediaUrl,
  }
}
