import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getOrCreateAlias, aliasAddress } from '@/lib/email/aliases'
import { activeGmailAccount } from '@/lib/connectors/composio-gmail'
import { EmailSetup } from '@/components/dashboard/email-setup'

export const dynamic = 'force-dynamic'

export default async function EmailSettingsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const session = await getSession()
  const params = await searchParams
  const tg = Number(session?.telegramId || 0)
  if (!tg) return null
  const { data: user } = await supabaseAdmin.from('users').select('name,gmail_connected,gmail_email').eq('telegram_id', tg).maybeSingle()
  const [alias, composioAccount, confirm] = await Promise.all([
    getOrCreateAlias(tg, user?.name || null).catch(() => null),
    activeGmailAccount(tg).catch(() => null),
    supabaseAdmin.from('inbound_emails').select('snippet,body_text,received_at').eq('telegram_id', tg).eq('category', 'forwarding_confirmation')
      .gte('received_at', new Date(Date.now() - 48 * 3600_000).toISOString()).order('received_at', { ascending: false }).limit(1),
  ])
  const code = String((confirm as any)?.data?.[0]?.snippet || '').match(/(\d{6,12})/)?.[1] || null
  const confirmLink = /^https:\/\/mail(?:-settings)?\.google\.com\//.test(String((confirm as any)?.data?.[0]?.body_text || '')) ? String((confirm as any).data[0].body_text) : null
  return <EmailSetup
    address={alias ? aliasAddress(alias.alias) : null}
    forwardingOn={Boolean(alias?.forwarding_confirmed_at)}
    confirmationCode={alias?.forwarding_confirmed_at ? null : code}
    confirmationLink={alias?.forwarding_confirmed_at ? null : confirmLink}
    googleConnected={Boolean(composioAccount) || Boolean(user?.gmail_connected)}
    googleEmail={user?.gmail_connected ? String(user?.gmail_email || '') : null}
    notice={params?.connected === 'google' ? 'Google is connected. Ask Gogo "emails that need me" to try it.' : params?.error === 'google_unavailable' ? 'Google sign-in is not available right now. Forwarding works meanwhile.' : null}
  />
}
