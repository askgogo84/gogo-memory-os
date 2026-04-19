import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const { telegramId, whatsappId } = await req.json()
    if (!telegramId && !whatsappId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    const trialEnds = new Date()
    trialEnds.setDate(trialEnds.getDate() + 7)

    const updateData = {
      tier: 'pro',
      is_trial: true,
      trial_started_at: new Date().toISOString(),
      trial_ends_at: trialEnds.toISOString(),
      tier_expires_at: trialEnds.toISOString(),
    }

    if (telegramId) {
      const { data: user } = await supabaseAdmin
        .from('users').select('trial_started_at')
        .eq('telegram_id', telegramId).single()
      if (user?.trial_started_at) {
        return NextResponse.json({ error: 'Trial already used' }, { status: 400 })
      }
      await supabaseAdmin.from('users').update(updateData).eq('telegram_id', telegramId)
    } else if (whatsappId) {
      const { data: user } = await supabaseAdmin
        .from('users').select('trial_started_at')
        .eq('whatsapp_id', whatsappId).single()
      if (user?.trial_started_at) {
        return NextResponse.json({ error: 'Trial already used' }, { status: 400 })
      }
      await supabaseAdmin.from('users').update(updateData).eq('whatsapp_id', whatsappId)
    }

    return NextResponse.json({ success: true, trial_ends: trialEnds.toISOString() })
  } catch (error) {
    console.error('Trial error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}