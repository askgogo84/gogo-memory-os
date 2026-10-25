import { NextRequest, NextResponse } from 'next/server'
import { handleSplitCommand } from '@/lib/splitwise/split-service'
import { isInternalServiceAuthorized } from '@/lib/security/cron-auth'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Internal service call only (bot pipeline, lib/feature-intents-legacy.ts sends the Bearer secret). `phone` is the
  // target owner the signed webhook already resolved, never authorization. 24 Oct: this route had no auth, so anyone
  // could read a stranger's split history/balances or add expenses to their groups by phone number.
  if (!isInternalServiceAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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
  // Internal service call only (bot pipeline, lib/feature-intents-legacy.ts sends the Bearer secret). `phone` is the
  // target owner the signed webhook already resolved, never authorization. 24 Oct: this route had no auth, so anyone
  // could read a stranger's split history/balances or add expenses to their groups by phone number.
  if (!isInternalServiceAuthorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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
