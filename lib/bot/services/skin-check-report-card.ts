import React from 'react'
import { ImageResponse } from 'next/og'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getLatestSkinChecks } from '@/lib/bot/services/skin-check-storage'

export function isSkinReportCardCommand(text: string) {
  const lower = (text || '').toLowerCase().replace(/[*_~`]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
  const compact = lower.replace(/\s+/g, '')
  return lower.includes('skin report card') || lower.includes('create skin report card') || lower.includes('generate skin report card') || lower.includes('visual skin report') || lower.includes('share skin report') || compact.includes('skinreportcard') || compact.includes('createskinreportcard') || compact.includes('generateskinreportcard') || compact.includes('visualskinreport')
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

function zone(report: any, key: string, fallback = '-') {
  return report?.face_zones_json?.[key] ?? fallback
}

function scorePercent(value: any, fallback = 65) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.min(100, parsed))
}

function levelPercent(value: any, fallback = 55) {
  const lower = clean(value, '').toLowerCase()
  if (lower.includes('high') || lower.includes('visible') || lower.includes('oily')) return 72
  if (lower.includes('moderate') || lower.includes('mild')) return 52
  if (lower.includes('low') || lower.includes('smooth') || lower.includes('clear')) return 28
  return fallback
}

function list(items: any[], limit: number, fallback: string[] = []) {
  const values = (items || []).map((item) => clean(item, '')).filter(Boolean).slice(0, limit)
  return values.length ? values : fallback.slice(0, limit)
}

function box(children: React.ReactNode, style: React.CSSProperties) {
  return React.createElement('div', { style }, children)
}

function Txt(props: { children: React.ReactNode; style?: React.CSSProperties }) {
  return React.createElement('div', { style: props.style }, props.children)
}

export async function getSkinCheckReportById(id: string) {
  const { data, error } = await supabaseAdmin.from('skin_check_reports').select('*').eq('id', id).maybeSingle()
  if (error) {
    console.error('[skin-report-card] fetch failed:', error.message)
    return null
  }
  return data
}

export async function buildSkinReportCardImageResponse(report: any) {
  return buildSkinReportCardSafeFallbackImageResponse(report)
}

function SectionTitle(props: { number: string; title: string }) {
  return box([
    box(props.number, { width: 24, height: 24, borderRadius: 99, border: '1px solid #725434', color: '#c99a5d', fontSize: 13, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 9 }),
    Txt({ children: props.title, style: { color: '#b88952', fontSize: 18, fontWeight: 900, letterSpacing: 1.4 } }),
  ], { display: 'flex', flexDirection: 'row', alignItems: 'center' })
}

function Pill(props: { label: string; value: string }) {
  return box([
    Txt({ children: props.label, style: { color: '#8d7b65', fontSize: 11, fontWeight: 900, textAlign: 'center', letterSpacing: 0.8 } }),
    Txt({ children: props.value, style: { color: '#e6dcc9', fontSize: 15, fontWeight: 900, marginTop: 8, textAlign: 'center', lineHeight: 1.1 } }),
  ], { width: 105, height: 82, borderRadius: 12, border: '1px solid #312b23', background: '#151614', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 8 })
}

function Slider(props: { title: string; left: string; right: string; percent: number; color?: string }) {
  const p = Math.max(8, Math.min(92, props.percent))
  return box([
    Txt({ children: props.title, style: { color: '#a98a60', fontSize: 13, fontWeight: 900, textAlign: 'center' } }),
    box([box(null, { width: '100%', height: 3, background: '#5b5146', borderRadius: 99 }), box(null, { position: 'absolute', left: `${p}%`, top: -5, width: 14, height: 14, borderRadius: 99, background: props.color || '#c89b5b' })], { display: 'flex', position: 'relative', width: 155, height: 18, marginTop: 10, alignItems: 'center' }),
    box([Txt({ children: props.left, style: { color: '#79766f', fontSize: 9, fontWeight: 700 } }), Txt({ children: props.right, style: { color: '#79766f', fontSize: 9, fontWeight: 700 } })], { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', width: 155 }),
  ], { width: 174, display: 'flex', flexDirection: 'column', alignItems: 'center' })
}

function Concern(props: { label: string; active?: boolean }) {
  return box([
    box(props.label.slice(0, 1), { width: 44, height: 44, borderRadius: 99, border: `1px solid ${props.active ? '#b88952' : '#3a3a34'}`, color: props.active ? '#c99a5d' : '#777', fontSize: 20, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', background: props.active ? '#211b15' : '#121412' }),
    Txt({ children: props.label, style: { color: props.active ? '#c7a26f' : '#8d8b83', fontSize: 10, fontWeight: 900, marginTop: 8, textAlign: 'center' } }),
  ], { width: 77, display: 'flex', flexDirection: 'column', alignItems: 'center' })
}

function Bullet(props: { text: string; color?: string }) {
  return box([box(null, { width: 6, height: 6, borderRadius: 99, background: props.color || '#c89b5b', marginTop: 7, marginRight: 8, flexShrink: 0 }), Txt({ children: props.text, style: { color: '#e3d7c0', fontSize: 12, fontWeight: 700, lineHeight: 1.25 } })], { display: 'flex', flexDirection: 'row', marginBottom: 6 })
}

function FaceIllustration() {
  return box([
    box(null, { position: 'absolute', top: 45, left: 102, width: 150, height: 210, borderRadius: '50% 50% 42% 42%', background: '#8e6046', border: '2px solid #5e4931' }),
    box(null, { position: 'absolute', top: 33, left: 87, width: 180, height: 58, borderRadius: '50%', background: '#2b211c' }),
    box(null, { position: 'absolute', top: 96, left: 125, width: 38, height: 13, borderRadius: 99, background: '#171514' }),
    box(null, { position: 'absolute', top: 96, left: 193, width: 38, height: 13, borderRadius: 99, background: '#171514' }),
    box(null, { position: 'absolute', top: 140, left: 168, width: 20, height: 52, borderRadius: 15, background: '#754d3a' }),
    box(null, { position: 'absolute', top: 208, left: 142, width: 72, height: 11, borderRadius: 99, background: '#2b1916' }),
    box(null, { position: 'absolute', top: 78, left: 128, width: 100, height: 38, borderRadius: '50%', background: '#d7a05c', opacity: 0.22, border: '1px solid #d5b27b' }),
    box(null, { position: 'absolute', top: 130, left: 96, width: 64, height: 46, borderRadius: '50%', background: '#7ba7c3', opacity: 0.22, border: '1px solid #a9bfca' }),
    box(null, { position: 'absolute', top: 130, left: 196, width: 64, height: 46, borderRadius: '50%', background: '#7ba7c3', opacity: 0.22, border: '1px solid #a9bfca' }),
    box(null, { position: 'absolute', top: 126, left: 162, width: 32, height: 92, borderRadius: 30, background: '#c99a5d', opacity: 0.23 }),
    box(null, { position: 'absolute', top: 225, left: 127, width: 100, height: 38, borderRadius: '50%', background: '#7e9e67', opacity: 0.23, border: '1px solid #a9b98e' }),
  ], { position: 'relative', width: 356, height: 305, borderRadius: 18, background: 'linear-gradient(135deg,#33261f,#151514)', border: '1px solid #5e4931', overflow: 'hidden' })
}

function RoutineItem(props: { title: string; tag: string }) {
  return box([
    box(null, { width: 42, height: 54, borderRadius: '12px 12px 18px 18px', background: '#d8d0bf', border: '1px solid #9f9178' }),
    Txt({ children: short(props.title, 18), style: { marginTop: 8, color: '#d8d0bf', fontSize: 10, fontWeight: 800, textAlign: 'center', lineHeight: 1.1 } }),
    box(props.tag, { marginTop: 6, color: '#111412', background: '#b9965f', borderRadius: 99, padding: '3px 8px', fontSize: 9, fontWeight: 900 }),
  ], { width: 86, display: 'flex', flexDirection: 'column', alignItems: 'center' })
}

export async function buildSkinReportCardSafeFallbackImageResponse(report: any) {
  const hydration = score(report, 'hydration', 70)
  const barrier = score(report, 'barrier_support', 65)
  const oiliness = short(score(report, 'oiliness', 'moderate'), 18)
  const texture = short(score(report, 'texture', 'smooth'), 18)
  const skinType = short(report.skin_type || 'Combination', 20)
  const sensitivity = short(score(report, 'sensitivity', 'low'), 16)
  const observations = list(report.observations_json || [], 4, ['T-zone shine visible', 'Mild under-eye darkness', 'Even overall tone', 'Skin barrier appears stable'])
  const am = list(report.am_routine_json || [], 5, ['Gentle cleanser', 'Hydrating serum', 'Niacinamide serum', 'Light moisturizer', 'SPF 50 sunscreen'])
  const pm = list(report.pm_routine_json || [], 4, ['Gentle cleanser', 'Repair treatment', 'Barrier serum', 'Light moisturizer'])
  const cautions = list(report.cautions_json || [], 4, ['Harsh exfoliation', 'Strong actives too often', 'Stripping cleansers', 'Heavy fragrance'])
  const forehead = short(zone(report, 'forehead', 'mild texture'), 26)
  const undereye = short(zone(report, 'under-eye') || zone(report, 'under_eye') || 'mild darkness', 26)
  const cheeks = short(zone(report, 'cheeks', 'even tone'), 26)
  const tzone = short(zone(report, 'nose_t-zone') || zone(report, 'nose___t-zone') || zone(report, 'nose__t-zone') || 'visible oiliness', 26)
  const chin = short(zone(report, 'chin') || zone(report, 'jawline') || 'balanced', 26)
  const dateLabel = report?.created_at ? new Date(report.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

  const element = box([
    box(null, { position: 'absolute', inset: 0, background: '#080a09' }),
    Txt({ children: 'SKIN ANALYSIS & CONSULTATION', style: { position: 'absolute', top: 38, left: 0, right: 0, color: '#c39a61', fontSize: 43, fontWeight: 700, letterSpacing: 4, textAlign: 'center' } }),
    Txt({ children: 'PERSONALIZED SKIN INSIGHTS', style: { position: 'absolute', top: 92, left: 0, right: 0, color: '#8e938c', fontSize: 15, fontWeight: 800, letterSpacing: 6, textAlign: 'center' } }),
    Txt({ children: dateLabel, style: { position: 'absolute', right: 38, top: 43, color: '#cdb487', fontSize: 18, fontWeight: 800 } }),

    box([FaceIllustration()], { position: 'absolute', top: 138, left: 42, width: 382, height: 330, borderRadius: 20, border: '1px solid #5e4931', padding: 12, background: '#111210' }),

    box([SectionTitle({ number: '1', title: 'FACIAL MAP' }), box([FaceIllustration(), box([Bullet({ text: `Forehead: ${forehead}` }), Bullet({ text: `Under-eye: ${undereye}` }), Bullet({ text: `Cheeks: ${cheeks}` }), Bullet({ text: `Nose / T-zone: ${tzone}` }), Bullet({ text: `Chin / Jawline: ${chin}` })], { display: 'flex', flexDirection: 'column', width: 205, marginLeft: 18, marginTop: 12 })], { display: 'flex', flexDirection: 'row', marginTop: 14 })], { position: 'absolute', top: 138, left: 442, width: 596, height: 330, borderRadius: 18, border: '1px solid #2d2d28', background: '#111210', padding: 16 }),

    box([SectionTitle({ number: '2', title: 'AT A GLANCE' }), box([Pill({ label: 'SKIN TYPE', value: skinType }), Pill({ label: 'OILINESS', value: oiliness }), Pill({ label: 'TEXTURE', value: texture }), Pill({ label: 'HYDRATION', value: `${scorePercent(hydration, 70)}%` }), Pill({ label: 'BARRIER', value: `${scorePercent(barrier, 65)}%` })], { display: 'flex', flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 })], { position: 'absolute', top: 486, left: 42, width: 996, height: 148, borderRadius: 18, border: '1px solid #2d2d28', background: '#111210', padding: 16 }),

    box([SectionTitle({ number: '3', title: 'CONCERNS' }), box([Concern({ label: 'TEXTURE', active: true }), Concern({ label: 'REDNESS' }), Concern({ label: 'DEHYDRATION', active: true }), Concern({ label: 'FINE LINES' }), Concern({ label: 'PORES', active: true }), box(null, { width: 1, height: 64, background: '#2d2d28', marginLeft: 5, marginRight: 5 }), Slider({ title: 'TEXTURE', left: 'SMOOTH', right: 'UNEVEN', percent: levelPercent(texture, 44) }), Slider({ title: 'PORES', left: 'SMALL', right: 'VISIBLE', percent: levelPercent(tzone, 58), color: '#597aa5' }), Slider({ title: 'SENSITIVITY', left: 'LOW', right: 'HIGH', percent: levelPercent(sensitivity, 30), color: '#be6a65' })], { display: 'flex', flexDirection: 'row', alignItems: 'center', marginTop: 14 })], { position: 'absolute', top: 650, left: 42, width: 996, height: 126, borderRadius: 18, border: '1px solid #2d2d28', background: '#111210', padding: 16 }),

    box([SectionTitle({ number: '4', title: 'CURRENT VS TARGET BALANCE' }), box([box([FaceIllustration()], { width: 140, height: 126, overflow: 'hidden', borderRadius: 14 }), box(observations.slice(0, 4).map((item) => Bullet({ text: short(item, 32), color: '#6e96c6' })), { width: 210, marginLeft: 16, marginTop: 8 }), Txt({ children: '>', style: { color: '#c99a57', fontSize: 38, fontWeight: 900, marginTop: 50, marginLeft: 10, marginRight: 10 } }), box([FaceIllustration()], { width: 140, height: 126, overflow: 'hidden', borderRadius: 14 }), box([Bullet({ text: 'Smoother texture' }), Bullet({ text: 'Hydrated glow' }), Bullet({ text: 'Calmer tone' }), Bullet({ text: 'Stronger barrier' })], { width: 190, marginLeft: 16, marginTop: 8 })], { display: 'flex', flexDirection: 'row', marginTop: 14 })], { position: 'absolute', top: 792, left: 42, width: 736, height: 202, borderRadius: 18, border: '1px solid #2d2d28', background: '#111210', padding: 16 }),

    box([SectionTitle({ number: '5', title: 'AVOID / CAUTION' }), box(cautions.slice(0, 4).map((item) => box([box('!', { width: 31, height: 31, borderRadius: 99, border: '1px solid #6d302f', color: '#d26b60', fontSize: 19, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 10 }), Txt({ children: short(item, 24), style: { color: '#ce8578', fontSize: 13, fontWeight: 900, lineHeight: 1.1 } })], { display: 'flex', flexDirection: 'row', alignItems: 'center', marginBottom: 12 })), { marginTop: 16 })], { position: 'absolute', top: 792, left: 796, width: 242, height: 202, borderRadius: 18, border: '1px solid #3b2b29', background: '#111210', padding: 16 }),

    box([SectionTitle({ number: '6', title: 'PERSONALIZED ROUTINE' }), box([Txt({ children: 'AM', style: { width: 58, color: '#d3a665', fontSize: 18, fontWeight: 900, marginTop: 36 } }), ...am.slice(0, 5).map((item, i) => RoutineItem({ title: item, tag: ['CLEANSE', 'HYDRATE', 'BALANCE', 'REPAIR', 'PROTECT'][i] || 'STEP' }))], { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', marginTop: 14 }), box([Txt({ children: 'PM', style: { width: 58, color: '#8da6d8', fontSize: 18, fontWeight: 900, marginTop: 36 } }), ...pm.slice(0, 4).map((item, i) => RoutineItem({ title: item, tag: ['CLEANSE', 'RENEW', 'SOOTHE', 'REPAIR'][i] || 'STEP' }))], { display: 'flex', flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 })], { position: 'absolute', bottom: 86, left: 42, width: 996, height: 232, borderRadius: 18, border: '1px solid #2d2d28', background: '#111210', padding: 16 }),

    box([Txt({ children: '7  EXPERT NOTES', style: { color: '#d4a66d', fontSize: 16, fontWeight: 900, letterSpacing: 1.2, marginRight: 30 } }), Txt({ children: 'BARRIER FIRST', style: { color: '#bca681', fontSize: 15, fontWeight: 900, marginRight: 38 } }), Txt({ children: 'HYDRATE DAILY', style: { color: '#bca681', fontSize: 15, fontWeight: 900, marginRight: 38 } }), Txt({ children: 'PROTECT AM', style: { color: '#bca681', fontSize: 15, fontWeight: 900, marginRight: 38 } }), Txt({ children: 'CONSISTENCY WINS', style: { color: '#bca681', fontSize: 15, fontWeight: 900 } })], { position: 'absolute', bottom: 34, left: 42, width: 996, height: 40, borderRadius: 12, border: '1px solid #2d2d28', background: '#111210', display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '0 16px' }),
  ], { display: 'flex', position: 'relative', width: '100%', height: '100%', background: '#080a09', fontFamily: 'Arial, sans-serif', overflow: 'hidden' })

  return new ImageResponse(element, { width: 1080, height: 1350 })
}

export async function buildSkinReportCardReply(telegramId?: number) {
  if (!telegramId) return `Skin Report Card\n\nRun skin check first, then say create skin report card.`
  const [latest] = await getLatestSkinChecks(telegramId, 1)
  if (!latest) return `Skin Report Card\n\nNo skin check found yet. Send a clear selfie and type skin check first.`
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'
  const mediaUrl = `${appUrl}/api/skin-report-card/${latest.id}`
  return { text: `Skin Report Card ready\n\nI created your visual Skin Check card.\n\nOpen card:\n${mediaUrl}\n\nTip: take your next selfie in similar lighting for cleaner progress tracking.`, mediaUrl }
}
