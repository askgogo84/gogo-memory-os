import { ImageResponse } from 'next/og'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyCardToken } from '@/lib/security/card-link'
import { flightCardModel, formatInr, type FlightCardModel } from '@/lib/agent/flight-card'

// Result cards, Phase 1 (docs/result-cards): the WhatsApp flight card. Signed link only (?o=owner&t=token bound to
// this run), and the rows come from the run's own verified Google Flights step. Any failure is a 404.
export const dynamic = 'force-dynamic'
export const runtime = 'edge'

const W = 1080
const INK = '#111511', MUTED = '#5d645d', LINE = '#e3e6e1', ACCENT = '#1f7a5a', ACCENT_SOFT = '#e6f3ed', BG = '#ffffff'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function db() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!) }

/** Inter subset from Google Fonts for exactly the characters drawn (the bundled font has no ₹). */
async function interSubset(weight: number, text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(`https://fonts.googleapis.com/css2?family=Inter:wght@${weight}&text=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(2500) }).then(r => r.ok ? r.text() : '')
    const url = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/)?.[1]
    if (!url) return null
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) })
    return res.ok ? await res.arrayBuffer() : null
  } catch { return null }
}

function observedLabel(iso: string | null) {
  if (!iso) return 'From Google Flights · fares move'
  const t = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).format(new Date(iso)).toLowerCase()
  return `From Google Flights at ${t} · fares move`
}

function tree(model: FlightCardModel, rupee: boolean, height: number) {
  const d = (style: any, children?: any): any => ({ type: 'div', props: { style: { display: 'flex', ...style }, children } })
  const t = (text: string, style: any = {}): any => d({ fontSize: 30, color: INK, fontWeight: 400, lineHeight: 1.25, ...style }, text)
  const rows = model.rows.slice(0, 3)
  return d({ flexDirection: 'column', width: W, height, background: BG, fontFamily: 'Inter' }, [
    d({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', padding: '56px 64px 36px' }, [
      d({ flexDirection: 'column' }, [
        t('AskGogo · Flights', { fontSize: 24, color: ACCENT, fontWeight: 700, letterSpacing: 1 }),
        t(`${model.route} · ${model.when}`, { fontSize: 52, fontWeight: 700, marginTop: 10 }),
      ]),
      t(model.party, { fontSize: 28, color: MUTED, marginBottom: 6 }),
    ]),
    ...rows.map(r => d({ flexDirection: 'row', alignItems: 'center', padding: '30px 64px', borderTop: `2px solid ${LINE}`, background: r.pick ? ACCENT_SOFT : BG }, [
      d({ width: 52, height: 52, borderRadius: 26, background: INK, color: '#fff', fontSize: 26, fontWeight: 700, alignItems: 'center', justifyContent: 'center', marginRight: 28, flexShrink: 0 }, String(r.n)),
      d({ flexDirection: 'column', flex: 1 }, [
        d({ flexDirection: 'row', alignItems: 'center' }, [
          d({ width: 52, height: 40, borderRadius: 10, background: r.colour, color: '#fff', fontSize: 20, fontWeight: 700, alignItems: 'center', justifyContent: 'center', marginRight: 16 }, r.code),
          t(`${r.airline} · ${r.stops}`, { fontSize: 34, fontWeight: 600 }),
        ]),
        t(`${r.departure} → ${r.arrival}`, { fontSize: 30, color: MUTED, marginTop: 10 }),
      ]),
      d({ flexDirection: 'column', alignItems: 'flex-end' }, [
        t(formatInr(r.fareInr, rupee), { fontSize: 44, fontWeight: 700 }),
        ...(r.pick ? [t("Gogo's pick", { fontSize: 24, color: ACCENT, fontWeight: 600, marginTop: 4 })] : []),
      ]),
    ])),
    d({ flexDirection: 'row', justifyContent: 'space-between', padding: '28px 64px 44px', borderTop: `2px solid ${LINE}`, marginTop: 'auto' }, [
      t(observedLabel(model.observedAt), { fontSize: 24, color: MUTED }),
      t(model.rows.length > 3 ? `+${model.rows.length - 3} more in the message` : 'app.askgogo.in', { fontSize: 24, color: MUTED }),
    ]),
  ])
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await ctx.params
    const owner = req.nextUrl.searchParams.get('o') || ''
    if (!UUID.test(runId) || !(await verifyCardToken(`flights.${runId}`, owner, req.nextUrl.searchParams.get('t')))) return new NextResponse('Not found', { status: 404 })
    const { data: run } = await db().from('agent_runs').select('id,status').eq('id', runId).eq('telegram_id', owner).eq('type', 'travel_research').maybeSingle()
    if (!run || run.status !== 'completed') return new NextResponse('Not found', { status: 404 })
    const { data: steps } = await db().from('agent_steps').select('output_json,completed_at').eq('run_id', runId).eq('telegram_id', owner).eq('status', 'completed').order('completed_at', { ascending: false }).limit(5)
    const step = (steps || []).find((s: any) => s?.output_json?.inventoryType === 'browser-verified')
    const model = step ? flightCardModel({ ...step.output_json, observedAt: step.completed_at }) : null
    if (!model) return new NextResponse('Not found', { status: 404 })
    const rows = Math.min(3, model.rows.length)
    const height = 240 + rows * 156 + 96
    const text = JSON.stringify(model) + "AskGogo·FlightsGogo's pickFrom Google Flights at fares move+more in the messageapp.askgogo.in→₹0123456789amp"
    const [regular, semibold, bold] = await Promise.all([interSubset(400, text), interSubset(600, text), interSubset(700, text)])
    const fonts = [regular && { name: 'Inter', data: regular, weight: 400 as const }, semibold && { name: 'Inter', data: semibold, weight: 600 as const }, bold && { name: 'Inter', data: bold, weight: 700 as const }].filter(Boolean) as any[]
    return new ImageResponse(tree(model, fonts.length === 3, height) as any, {
      width: W, height, ...(fonts.length === 3 ? { fonts } : {}),
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=300' },
    })
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }
}
