import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'
import { normalizeMemberName, parseSplitIntent, SplitAllocation } from './split-parser'
import { simplifyDebts } from './simplify-debts'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'
const ASK_GOGO_WHATSAPP_NUMBER = process.env.ASKGOGO_WHATSAPP_NUMBER || process.env.NEXT_PUBLIC_ASKGOGO_WHATSAPP_NUMBER || ''

type Group = { id: string; name: string; owner_phone: string; currency: string }
type Expense = { id: string; group_id: string; total_amount: number; paid_by: string; description: string; category: string; created_at: string }
type Share = { expense_id: string; group_id: string; member_name: string; owed_amount: number }
type Settlement = { group_id: string; from_member: string; to_member: string; amount: number }
type Member = { name: string; phone?: string | null }

function money(value: number) {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  return `₹${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2)}`
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function guessCategory(description: string) {
  const d = description.toLowerCase()
  if (/hotel|stay|airbnb|room/.test(d)) return 'stay'
  if (/cab|uber|ola|auto|fuel|petrol|flight|train|bus|travel/.test(d)) return 'travel'
  if (/dinner|lunch|breakfast|food|restaurant|cafe|bar|drinks/.test(d)) return 'food'
  if (/ticket|entry|movie|activity/.test(d)) return 'activity'
  if (/rent|maid|internet|wifi|subscription/.test(d)) return 'recurring'
  return 'general'
}

function waDeepLink(message: string) {
  const cleanNumber = ASK_GOGO_WHATSAPP_NUMBER.replace(/[^\d]/g, '')
  const encoded = encodeURIComponent(message)
  return cleanNumber ? `https://wa.me/${cleanNumber}?text=${encoded}` : `https://wa.me/?text=${encoded}`
}

async function getLatestGroup(phone: string): Promise<Group | null> {
  const { data } = await supabaseAdmin
    .from('split_groups')
    .select('id,name,owner_phone,currency')
    .or(`owner_phone.eq.${phone},id.in.(${await groupIdsForPhone(phone)})`)
    .order('updated_at', { ascending: false })
    .limit(1)
  return (data?.[0] as Group) || null
}

async function groupIdsForPhone(phone: string) {
  const { data } = await supabaseAdmin
    .from('split_group_members')
    .select('group_id')
    .eq('phone', phone)
  const ids = (data || []).map((row: any) => row.group_id).filter(Boolean)
  return ids.length ? ids.join(',') : '00000000-0000-0000-0000-000000000000'
}

async function findGroup(phone: string, groupName?: string): Promise<Group | null> {
  const memberGroupIds = await groupIdsForPhone(phone)
  if (!groupName) return getLatestGroup(phone)
  const { data } = await supabaseAdmin
    .from('split_groups')
    .select('id,name,owner_phone,currency')
    .or(`owner_phone.eq.${phone},id.in.(${memberGroupIds})`)
    .ilike('name', `%${groupName}%`)
    .order('updated_at', { ascending: false })
    .limit(1)
  return (data?.[0] as Group) || null
}

async function ensureGroup(phone: string, groupName?: string, members: string[] = []) {
  let group = await findGroup(phone, groupName)
  if (!group) {
    const name = groupName || 'My Split Group'
    const { data, error } = await supabaseAdmin
      .from('split_groups')
      .insert({ owner_phone: phone, name, currency: 'INR' })
      .select('id,name,owner_phone,currency')
      .single()
    if (error) throw error
    group = data as Group
  }

  const normalized = Array.from(new Set(['Me', ...members.map(normalizeMemberName).filter(Boolean)]))
  if (normalized.length) {
    await supabaseAdmin.from('split_group_members').upsert(
      normalized.map((name) => ({ group_id: group!.id, name, phone: name === 'Me' ? phone : null })),
      { onConflict: 'group_id,name' }
    )
  }

  await supabaseAdmin.from('split_groups').update({ updated_at: new Date().toISOString() }).eq('id', group.id)
  return group
}

async function getMembers(groupId: string): Promise<Member[]> {
  const { data } = await supabaseAdmin
    .from('split_group_members')
    .select('name,phone')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
  return (data || []).map((row: any) => ({ name: row.name as string, phone: row.phone as string | null }))
}

async function calculateBalances(groupId: string) {
  const { data: expenses } = await supabaseAdmin
    .from('split_expenses')
    .select('id,group_id,total_amount,paid_by,description,category,created_at')
    .eq('group_id', groupId)
  const { data: shares } = await supabaseAdmin
    .from('split_expense_shares')
    .select('expense_id,group_id,member_name,owed_amount')
    .eq('group_id', groupId)
  const { data: settlements } = await supabaseAdmin
    .from('split_settlements')
    .select('group_id,from_member,to_member,amount')
    .eq('group_id', groupId)

  const balances: Record<string, number> = {}
  const add = (name: string, amount: number) => {
    const key = normalizeMemberName(name)
    balances[key] = roundMoney((balances[key] || 0) + amount)
  }

  ;((expenses || []) as Expense[]).forEach((expense) => add(expense.paid_by, Number(expense.total_amount)))
  ;((shares || []) as Share[]).forEach((share) => add(share.member_name, -Number(share.owed_amount)))
  ;((settlements || []) as Settlement[]).forEach((settlement) => {
    add(settlement.from_member, Number(settlement.amount))
    add(settlement.to_member, -Number(settlement.amount))
  })

  Object.keys(balances).forEach((name) => {
    if (Math.abs(balances[name]) < 0.01) balances[name] = 0
  })

  return { balances, expenses: (expenses || []) as Expense[] }
}

function computeShares(params: {
  amount: number
  paidBy: string
  members: string[]
  allocations: SplitAllocation[]
  splitMode: 'equal' | 'unequal' | 'percent' | 'shares'
}) {
  const paidBy = normalizeMemberName(params.paidBy)
  let members = Array.from(new Set(params.members.map(normalizeMemberName).filter(Boolean)))

  if (params.allocations.length) members = Array.from(new Set(params.allocations.map((a) => normalizeMemberName(a.member)).filter(Boolean)))
  if (!members.length) members = [paidBy]
  if (!members.some((m) => m.toLowerCase() === paidBy.toLowerCase())) members.unshift(paidBy)

  if (params.splitMode === 'unequal') {
    const total = roundMoney(params.allocations.reduce((sum, item) => sum + Number(item.value || 0), 0))
    if (Math.abs(total - params.amount) > 1) {
      throw new Error(`Unequal split total is ${money(total)}, but expense is ${money(params.amount)}.`)
    }
    return params.allocations.map((item) => ({ member: normalizeMemberName(item.member), owedAmount: roundMoney(Number(item.value)) }))
  }

  if (params.splitMode === 'percent') {
    const totalPercent = roundMoney(params.allocations.reduce((sum, item) => sum + Number(item.value || 0), 0))
    if (Math.abs(totalPercent - 100) > 0.5) {
      throw new Error(`Percentage split totals ${totalPercent}%, but should be 100%.`)
    }
    return params.allocations.map((item) => ({ member: normalizeMemberName(item.member), owedAmount: roundMoney((params.amount * Number(item.value)) / 100) }))
  }

  if (params.splitMode === 'shares') {
    const totalShares = params.allocations.reduce((sum, item) => sum + Number(item.value || 0), 0)
    if (totalShares <= 0) throw new Error('Share split needs at least one share.')
    return params.allocations.map((item) => ({ member: normalizeMemberName(item.member), owedAmount: roundMoney((params.amount * Number(item.value)) / totalShares) }))
  }

  const perPerson = roundMoney(params.amount / members.length)
  return members.map((member) => ({ member, owedAmount: perPerson }))
}

async function notifyLinkedMembers(groupId: string, actorPhone: string, message: string) {
  const members = await getMembers(groupId)
  const phones = Array.from(new Set(members.map((m) => m.phone).filter(Boolean) as string[])).filter((phone) => phone !== actorPhone)
  await Promise.allSettled(phones.map((phone) => sendWhatsAppMessage(phone, message)))
}

export async function handleSplitCommand(phone: string, text: string) {
  const intent = parseSplitIntent(text)
  if (!intent) return null

  if (intent.type === 'join') {
    const { data: invite } = await supabaseAdmin
      .from('split_invites')
      .select('id,group_id,invited_name,invited_phone,status')
      .eq('invite_code', intent.inviteCode)
      .maybeSingle()

    if (!invite) return `Invite not found. Ask the trip owner to send the AskGogo Split invite again.`

    await supabaseAdmin
      .from('split_group_members')
      .upsert({ group_id: invite.group_id, name: invite.invited_name, phone }, { onConflict: 'group_id,name' })

    await supabaseAdmin.from('split_invites').update({ status: 'joined', invited_phone: phone }).eq('id', invite.id)

    const { data: group } = await supabaseAdmin
      .from('split_groups')
      .select('id,name')
      .eq('id', invite.group_id)
      .single()

    await notifyLinkedMembers(invite.group_id, phone, `🔔 *${invite.invited_name} joined ${group?.name || 'the split'}*\n\nThey can now add expenses and see balances from their own WhatsApp.`)

    return `✅ *Joined ${group?.name || 'split group'}*\n\nYou can now add expenses here.\nTry: *Add expense 500 lunch paid by me split equally*`
  }

  if (intent.type === 'create_group') {
    const group = await ensureGroup(phone, intent.groupName, intent.members)
    const members = await getMembers(group.id)
    return `✅ *AskGogo Split created*\n\n*${group.name}*\nMembers: ${members.map((m) => m.name).join(', ')}\n\nAdd your first expense like:\n_Add expense 2400 hotel paid by me in ${group.name} split equally_\n\nInvite friends like:\n_Invite Rahul 9876543210 to ${group.name}_`
  }

  if (intent.type === 'add_equal_expense') {
    const group = await ensureGroup(phone, intent.groupName, intent.members)
    const existingMembers = (await getMembers(group.id)).map((m) => m.name)
    const shareRows = computeShares({ amount: intent.amount, paidBy: intent.paidBy, members: intent.members.length ? intent.members : existingMembers, allocations: intent.allocations, splitMode: intent.splitMode })
    const members = shareRows.map((row) => row.member)
    await ensureGroup(phone, group.name, members)

    const { data: expense, error } = await supabaseAdmin
      .from('split_expenses')
      .insert({
        group_id: group.id,
        description: intent.description,
        total_amount: intent.amount,
        paid_by: intent.paidBy,
        category: guessCategory(intent.description),
        currency: 'INR',
        raw_text: intent.rawText,
      })
      .select('id')
      .single()
    if (error) throw error

    await supabaseAdmin.from('split_expense_shares').insert(
      shareRows.map((row) => ({ expense_id: expense.id, group_id: group.id, member_name: row.member, owed_amount: row.owedAmount }))
    )

    const { balances } = await calculateBalances(group.id)
    const summary = Object.entries(balances).map(([name, balance]) => `${name}: ${balance >= 0 ? 'gets' : 'owes'} ${money(Math.abs(balance))}`).join('\n')
    const splitDetails = shareRows.map((row) => `${row.member}: ${money(row.owedAmount)}`).join('\n')
    const modeLabel = intent.splitMode === 'equal' ? `${shareRows.length} people × ${money(shareRows[0]?.owedAmount || 0)}` : `${intent.splitMode} split\n${splitDetails}`

    await notifyLinkedMembers(group.id, phone, `🔔 *${group.name} updated*\n\n${intent.description}: ${money(intent.amount)}\nPaid by: ${intent.paidBy}\n\nSay *show balance ${group.name}* in AskGogo.`)

    return `✅ *Expense added to ${group.name}*\n\n${intent.description}\nTotal: *${money(intent.amount)}*\nPaid by: *${intent.paidBy}*\nSplit: ${modeLabel}\n\n*Current balance*\n${summary}\n\nSay: *simplify ${group.name}*`
  }

  if (intent.type === 'show_balance' || intent.type === 'simplify' || intent.type === 'share_chart' || intent.type === 'history') {
    const group = await findGroup(phone, intent.type === 'history' ? undefined : intent.groupName)
    if (!group) return `No split group found yet. Say: *Create trip Goa with Rahul, Priya, Meera*`
    const { balances, expenses } = await calculateBalances(group.id)

    if (intent.type === 'share_chart') {
      const inviteText = `Join AskGogo Split ${group.name}: ${waDeepLink(`join split ${group.id}`)}`
      return `📊 *${group.name} expense chart*\n\nOpen/share this card:\n${APP_URL}/api/splitbill/chart/${group.id}\n\nInvite friends through AskGogo WhatsApp:\n${inviteText}\n\nSay *show balance ${group.name}* for details.`
    }

    if (intent.type === 'history') {
      if (!expenses.length) return `No expenses yet. Add one like: *Add expense 2400 hotel paid by me split equally*`
      const recent = expenses.slice(-5).reverse().map((expense) => `• ${money(Number(expense.total_amount))} ${expense.description} — paid by ${expense.paid_by}`).join('\n')
      return `🧾 *Recent split expenses*\n\n*${group.name}*\n${recent}`
    }

    const balanceLines = Object.entries(balances)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .map(([name, balance]) => `${name}: ${balance >= 0 ? 'gets' : 'owes'} ${money(Math.abs(balance))}`)
      .join('\n') || 'All settled.'

    if (intent.type === 'show_balance') return `💸 *${group.name} balance*\n\n${balanceLines}\n\nSay: *simplify ${group.name}*`

    const suggestions = simplifyDebts(balances)
    if (!suggestions.length) return `✅ *${group.name} is settled*\n\nNo one owes anyone.`
    return `✅ *Simplified settlement for ${group.name}*\n\n${suggestions.map((s) => `${s.from} pays ${s.to}: *${money(s.amount)}*`).join('\n')}\n\nAfter payment, say: *Rahul paid Me 900 in ${group.name}*`
  }

  if (intent.type === 'settle') {
    const group = await findGroup(phone, intent.groupName)
    if (!group) return `No split group found. Say: *Create trip Goa with Rahul, Priya, Meera*`
    await supabaseAdmin.from('split_settlements').insert({ group_id: group.id, from_member: intent.from, to_member: intent.to, amount: intent.amount, note: intent.rawText })
    const { balances } = await calculateBalances(group.id)
    const suggestions = simplifyDebts(balances)
    await notifyLinkedMembers(group.id, phone, `🔔 *${group.name} settlement update*\n\n${intent.from} paid ${intent.to}: ${money(intent.amount)}\n\nSay *show balance ${group.name}* in AskGogo.`)
    return `✅ *Settlement recorded*\n\n${intent.from} paid ${intent.to}: *${money(intent.amount)}*\n\n${suggestions.length ? '*Remaining simplified settlement*\n' + suggestions.map((s) => `${s.from} pays ${s.to}: ${money(s.amount)}`).join('\n') : 'All settled now.'}`
  }

  if (intent.type === 'invite') {
    const group = await findGroup(phone, intent.groupName)
    if (!group) return `No split group found. Say: *Create trip Goa with Rahul, Priya, Meera*`
    await ensureGroup(phone, group.name, [intent.name])
    const { data } = await supabaseAdmin
      .from('split_invites')
      .insert({ group_id: group.id, invited_name: intent.name, invited_phone: intent.phone || null })
      .select('invite_code')
      .single()
    const joinCommand = `join split ${data?.invite_code}`
    const askGogoLink = waDeepLink(joinCommand)
    const directMessage = `Hey ${intent.name}, join our *${group.name}* expense tracker on AskGogo:\n${askGogoLink}\n\nOnce it opens, just send the prefilled message.`

    if (intent.phone) {
      await sendWhatsAppMessage(intent.phone, directMessage).catch((error: any) => console.error('[split-invite] direct send failed:', error?.message || error))
    }

    return `✉️ *Invite ready*\n\nInvite ${intent.name} to *${group.name}*:\n${askGogoLink}\n\n${intent.phone ? 'I also tried sending it directly on WhatsApp.' : 'Forward this link to them on WhatsApp.'}\n\nAfter joining, their expenses will update the same tracker and linked members will get updates.`
  }

  return null
}
