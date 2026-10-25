import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { verifyDailyBriefUnsubscribeToken } from '@/lib/email/daily-brief-unsubscribe'

export const dynamic = 'force-dynamic'

function page(title: string, body: string, status = 200) {
  return new NextResponse(`<!doctype html><html><body style="margin:0;background:#f5eee6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#3b2518"><div style="max-width:560px;margin:80px auto;padding:24px"><div style="background:#fffdf9;border:1px solid rgba(77,46,27,.10);border-radius:24px;padding:28px"><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:#bf6b2f">AskGogo</div><h1 style="font-family:Georgia,serif;font-size:28px">${title}</h1><p style="font-size:14px;line-height:1.7;color:#6f5b4e">${body}</p><a href="https://app.askgogo.in/dashboard/you" style="display:inline-block;margin-top:10px;padding:10px 14px;border-radius:999px;background:#2c211b;color:#fff;text-decoration:none;font-size:12px;font-weight:700">Open preferences</a></div></div></body></html>`, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const telegramId = (url.searchParams.get('u') || '').trim()
  const email = (url.searchParams.get('e') || '').trim().toLowerCase()
  const sig = (url.searchParams.get('s') || '').trim()

  if (!telegramId || !email || !verifyDailyBriefUnsubscribeToken(telegramId, email, sig)) {
    return page('That link is no longer valid.', 'Open AskGogo preferences to manage your Daily Brief email.', 400)
  }

  const { error } = await supabaseAdmin
    .from('users')
    .update({ daily_brief_email_enabled: false })
    .eq('telegram_id', Number(telegramId))
    .eq('email', email)

  if (error) {
    console.error('DAILY_BRIEF_EMAIL_UNSUBSCRIBE_FAILED:', error)
    return page('Couldn’t update that preference.', 'Please try again from your AskGogo dashboard.', 500)
  }

  return page('Daily Brief emails are off.', 'You can turn them back on anytime from Dashboard → You. Your WhatsApp Daily Brief setting is unchanged.')
}
