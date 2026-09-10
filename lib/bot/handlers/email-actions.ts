import { buildGmailConnectUrl, fetchLatestEmails, fetchUnreadEmails, refreshGmailAccessToken } from '@/lib/google-gmail'
import { supabaseAdmin } from '@/lib/supabase-admin'

function pickEmailByIntent(input: string, emails: any[]) {
  const lower = input.toLowerCase()
  const words = lower
    .replace(/[^a-z0-9@.]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3 && !['email','emails','gmail','latest','unread','reply','draft','about','from','show','find','read'].includes(word))

  const ranked = emails
    .map((email) => {
      const haystack = `${email.subject || ''} ${email.from || ''} ${email.snippet || ''}`.toLowerCase()
      return { email, score: words.reduce((score, word) => score + (haystack.includes(word) ? 1 : 0), 0) }
    })
    .sort((a, b) => b.score - a.score)

  return ranked[0]?.score > 0 ? ranked[0].email : emails[0]
}

function connectReply(telegramId: number, prefix: string) {
  const connectUrl = buildGmailConnectUrl(telegramId)
  if (!connectUrl) return `${prefix}\n\nGoogle connection is temporarily unavailable. Please try again shortly.`
  return `${prefix}\n\nConnect Google Workspace here:\n${connectUrl}\n\nThis asks only for the read-only Gmail, Contacts and Drive access Gogo needs for connected context. Consequential actions still require approval.`
}

export async function buildEmailActionReply(telegramId: number, input: string) {
  const { data: user } = await supabaseAdmin
    .from('users')
    .select('name, gmail_connected, gmail_access_token, gmail_refresh_token, gmail_email')
    .eq('telegram_id', telegramId)
    .single()

  if (!user?.gmail_connected) {
    return connectReply(telegramId, 'Your Google Workspace is not connected yet.')
  }

  const lower = input.toLowerCase()
  const wantsUnread = lower.includes('unread')

  let emails: any[] = []
  let accessToken = user.gmail_access_token || null
  let scopeRequired = false

  const fetchMode = async (token: string) =>
    wantsUnread ? await fetchUnreadEmails(token, 8) : await fetchLatestEmails(token, 8)

  if (accessToken) {
    try {
      emails = await fetchMode(accessToken)
    } catch (err) {
      scopeRequired = err instanceof Error && err.message === 'gmail_scope_required'
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

      accessToken = refreshedToken
      try {
        emails = await fetchMode(refreshedToken)
      } catch (err) {
        scopeRequired = scopeRequired || (err instanceof Error && err.message === 'gmail_scope_required')
        emails = []
      }
    }
  }

  if (scopeRequired) {
    return connectReply(telegramId, 'Your existing Google connection needs the new read-only Workspace permission before Gogo can read email context.')
  }

  if (!emails.length) {
    return connectReply(telegramId, "I couldn't fetch your email right now. Reconnecting Google Workspace usually fixes an expired or incomplete permission.")
  }

  const email = pickEmailByIntent(input, emails)
  const subject = email?.subject || '(No subject)'
  const from = email?.from || 'Unknown sender'
  const snippet = (email?.snippet || '').replace(/\s+/g, ' ').trim()
  const signature = String(user?.name || 'Gogo user').trim() || 'Gogo user'

  return `*Draft reply suggestion*\n\nTo: ${from}\nSubject: Re: ${subject}\n\nHi,\n\nThanks for the update. I’ve gone through this and will review it shortly.\n\n${snippet ? `Context I noted: ${snippet.slice(0, 220)}${snippet.length > 220 ? '...' : ''}\n\n` : ''}I’ll get back to you soon.\n\nBest,\n${signature}`
}
