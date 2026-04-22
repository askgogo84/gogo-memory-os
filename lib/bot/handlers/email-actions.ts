import { fetchLatestEmails, fetchUnreadEmails, refreshGmailAccessToken } from '@/lib/google-gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'

function pickEmailByIntent(input: string, emails: any[]) {
  const lower = input.toLowerCase()

  if (lower.includes('vercel')) {
    return emails.find((e) => (e.subject || '').toLowerCase().includes('vercel') || (e.from || '').toLowerCase().includes('vercel')) || emails[0]
  }

  return emails[0]
}

export async function buildEmailActionReply(telegramId: number, input: string) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('gmail_connected, gmail_access_token, gmail_refresh_token, gmail_email')
    .eq('telegram_id', telegramId)
    .single()

  if (!user?.gmail_connected) {
    const connectUrl = `https://app.askgogo.in/api/gmail/connect?telegramId=${telegramId}`
    return `Your Gmail is not connected yet.\n\nConnect it here:\n${connectUrl}`
  }

  const lower = input.toLowerCase()
  const wantsUnread = lower.includes('unread')

  let emails: any[] = []
  let accessToken = user.gmail_access_token || null

  const fetchMode = async (token: string) =>
    wantsUnread ? await fetchUnreadEmails(token, 5) : await fetchLatestEmails(token, 5)

  if (accessToken) {
    try {
      emails = await fetchMode(accessToken)
    } catch {
      emails = []
    }
  }

  if (!emails.length && user.gmail_refresh_token) {
    const refreshedToken = await refreshGmailAccessToken(user.gmail_refresh_token)

    if (refreshedToken) {
      await supabaseAdmin
        .from('users')
        .update({ gmail_access_token: refreshedToken })
        .eq('telegram_id', telegramId)

      try {
        emails = await fetchMode(refreshedToken)
      } catch {
        emails = []
      }
    }
  }

  if (!emails.length) {
    const connectUrl = `https://app.askgogo.in/api/gmail/connect?telegramId=${telegramId}`
    return `I couldn't fetch the email right now.\n\nTry reconnecting Gmail here:\n${connectUrl}`
  }

  const email = pickEmailByIntent(input, emails)
  const subject = email?.subject || '(No subject)'
  const from = email?.from || 'Unknown sender'
  const snippet = (email?.snippet || '').replace(/\s+/g, ' ').trim()

  return `*Draft reply suggestion*\n\nTo: ${from}\nSubject: Re: ${subject}\n\nHi,\n\nThanks for the update. I’ve gone through this and will review it shortly.\n\n${snippet ? `Context I noted: ${snippet.slice(0, 180)}${snippet.length > 180 ? '...' : ''}\n\n` : ''}I’ll get back to you soon.\n\nBest,\nGoverdhan`
}
