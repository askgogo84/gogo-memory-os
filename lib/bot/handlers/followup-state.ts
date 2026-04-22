import { supabaseAdmin } from '@/lib/supabase-admin'

export async function saveFollowupState(
  telegramId: number,
  kind: string,
  payload: Record<string, any>
) {
  await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content: JSON.stringify({
      type: 'followup_state',
      kind,
      payload,
      created_at: new Date().toISOString(),
    }),
  })
}

export async function getLatestFollowupState(telegramId: number, kind: string) {
  const { data } = await supabaseAdmin
    .from('memories')
    .select('content, created_at')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(20)

  const items = (data || [])
    .map((x: any) => {
      try {
        return JSON.parse(x.content)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .filter((x: any) => x.type === 'followup_state' && x.kind === kind)

  return items[0] || null
}
