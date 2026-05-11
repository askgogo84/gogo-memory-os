import { NextRequest, NextResponse } from 'next/server'
import { handleSplitCommand } from '@/lib/splitwise/split-service'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const phone = String(body.phone || '').trim()

    if (!phone) {
      return NextResponse.json({ error: 'phone required' }, { status: 400 })
    }

    const legacyText = body.text || buildLegacySplitText(body)
    if (!legacyText) {
      return NextResponse.json({
        reply:
          `AskGogo Split\n\n` +
          `Try:\n` +
          `Create trip Goa with Rahul, Priya, Meera\n` +
          `Add expense 2400 hotel paid by me in Goa split equally\n` +
          `Show balance Goa\n` +
          `Simplify Goa`,
      })
    }

    const reply = await handleSplitCommand(phone, String(legacyText))
    return NextResponse.json({ ok: true, reply: reply || 'I could not understand that split command yet.' })
  } catch (error: any) {
    console.error('[splitbill] POST failed:', error?.message || error)
    return NextResponse.json({ error: 'splitbill failed', reply: 'I could not save that split. Please try again.' }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const phone = req.nextUrl.searchParams.get('phone') || ''
    const group = req.nextUrl.searchParams.get('group') || ''
    const action = req.nextUrl.searchParams.get('action') || 'history'

    if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })

    const text = action === 'balance'
      ? `show balance ${group}`
      : action === 'simplify'
        ? `simplify ${group}`
        : 'split history'

    const reply = await handleSplitCommand(phone, text)
    return NextResponse.json({ ok: true, reply })
  } catch (error: any) {
    console.error('[splitbill] GET failed:', error?.message || error)
    return NextResponse.json({ error: 'splitbill failed', reply: 'I could not fetch your split history.' }, { status: 500 })
  }
}

function buildLegacySplitText(body: any) {
  if (!body.amount || !Array.isArray(body.people) || !body.people.length) return ''
  const description = body.description || 'Bill'
  return `Add expense ${body.amount} ${description} paid by me split with ${body.people.join(', ')}`
}
