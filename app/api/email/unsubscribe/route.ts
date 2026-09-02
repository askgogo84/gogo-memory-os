import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe'

export const dynamic = 'force-dynamic'

function page(title: string, detail: string, ok = true) {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#f7f0e7;color:#3e2312;font-family:Arial,Helvetica,sans-serif"><main style="max-width:560px;margin:10vh auto;padding:24px"><div style="background:#fffdf9;border:1px solid #eadfd3;border-radius:24px;padding:30px;box-shadow:0 18px 60px rgba(62,35,18,.08)"><div style="font-size:12px;text-transform:uppercase;letter-spacing:.14em;color:#9a8778;font-weight:700">AskGogo</div><h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.15;margin:10px 0 12px">${title}</h1><p style="font-size:16px;line-height:1.65;color:#6b4a34;margin:0">${detail}</p>${ok ? '<p style="margin:22px 0 0"><a href="https://app.askgogo.in/dashboard" style="display:inline-block;background:#f18219;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:700">Open AskGogo</a></p>' : ''}</div></main></body></html>`,
    { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  )
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const telegramId = (url.searchParams.get('u') || '').trim()
  const email = (url.searchParams.get('e') || '').trim().toLowerCase()
  const signature = (url.searchParams.get('s') || '').trim()

  if (!telegramId || !email || !verifyUnsubscribeToken(telegramId, email, signature)) {
    return page('That link is not valid', 'Please open your AskGogo dashboard if you want to manage your email preferences.', false)
  }

  const tg = Number(telegramId)
  if (!Number.isFinite(tg)) return page('That link is not valid', 'Please open your AskGogo dashboard if you want to manage your email preferences.', false)

  const { error } = await supabaseAdmin
    .from('users')
    .update({ email_opt_out: true })
    .eq('telegram_id', tg)
    .eq('email', email)

  if (error) {
    console.error('EMAIL_UNSUBSCRIBE_FAILED:', error)
    return page('Could not update that preference', 'Please try again in a few minutes, or manage your account from the dashboard.', false)
  }

  return page('Gogo Tips are paused', 'You will no longer receive AskGogo lifecycle tips at this email address. Your WhatsApp reminders and other product messages are unchanged.')
}
