import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsApp } from '@/lib/whatsapp'
export const dynamic = 'force-dynamic'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('phone')
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })
  const { data: user } = await supabase.from('users').select('id,referral_code').eq('whatsapp_id', phone).single()
  if (!user) return NextResponse.json({ error: 'user not found' }, { status: 404 })
  let code = user.referral_code
  if (!code) { code = 'AG' + Math.random().toString(36).substring(2,7).toUpperCase(); await supabase.from('users').update({ referral_code: code }).eq('id', user.id) }
  const { count } = await supabase.from('users').select('id',{ count:'exact' }).eq('referred_by',code).not('plan','eq','free')
  const paid = count || 0
  return NextResponse.json({ ok: true, code, paidReferrals: paid, reply: `🎁 *Your Referral Link*\n\nShare: https://app.askgogo.in?ref=${code}\n\nWhen they subscribe, you both get *1 free month!*\n\n• Paid referrals: ${paid}` })
}
export async function POST(req: NextRequest) {
  const { action, phone, code } = await req.json()
  if (action === 'apply') {
    const { data: ref } = await supabase.from('users').select('id').eq('referral_code',code.toUpperCase()).single()
    if (!ref) return NextResponse.json({ error: 'invalid code' }, { status: 400 })
    await supabase.from('users').update({ referred_by: code.toUpperCase() }).eq('whatsapp_id', phone)
    return NextResponse.json({ ok: true, reply: '🎕 Referral code applied!' })
  }
  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
