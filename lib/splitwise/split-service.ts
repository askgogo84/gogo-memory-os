import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeMemberName, parseSplitIntent } from './split-parser'
import { simplifyDebts } from './simplify-debts'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'

type Group = { id: string; name: string; owner_phone: string; currency: string }
type Expense = { id: string; group_id: string; total_amount: number; paid_by: string; description: string; category: string; created_at: string }
type Share = { expense_id: string; group_id: string; member_name: string; owed_amount: number }
type Settlement = { group_id: string; from_member: string; to_member: string; amount: number }

function money(value: number) {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100
  return `₹${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2)}`
}

function guessCategory(description: string) {
  const d = description.toLowerCase()
  if (/hotel|stay|airbnb|room/.test(d)) return 'stay'
  if (/cab|uber|ola|auto|fuel|petrol|flight|train|bus|travel/.test(d)) return 'travel'
  if (/dinner|lunch|breakfast|food|restaurant|cafe|bar|drinks/.test(d)) return 'food'
  if (/ticket|entry|movie|activity/.test(d)) return 'activity'
  return 'general'
}

async function getLatestGroup(phone: string): Promise<Group | null> {
  const { data } = await supabaseAdmin
    .from('split_groups')
    .select('id,name,owner_phone,currency')
    .eq('owner_phone', phone)
    .order('updated_at', { ascending: false })
    .limit(1)
  return (data?.[0] as Group) || null
}

async function findGroup(phone: string, groupName?: string): Promise<Group | null> {
  if (!groupName) return getLatestGroup(phone)
  const { data } = await supabaseAdmin
    .from('split_groups')
    .select('id,name,owner_phone,currency')
    .eq('owner_phone', phone)
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
      normalized.map((name) => ({ group_id: group!.id, name })),
      { onConflict: 'group_id,name' }
    )
  }

  await supabaseAdmin.from('split_groups').update({ updated_at: new Date().toISOString() }).eq('id', group.id)
  return group
}

async function getMembers(groupId: string) {
  const { data } = await supabaseAdmin
    .from('split_group_members')
    .select('name')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
  return (data || []).map((row: any) => row.name as string)
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
    balances[key] = Math.round(((balances[key] || 0) + amount) * 100) / 100
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

export async function handleSplitCommand(phone: string, text: string) {
  const intent = parseSplitIntent(text)
  if (!intent) return null

  if (intent.type === 'create_group') {
    const group = await ensureGroup(phone, intent.groupName, intent.members)
    const members = await getMembers(group.id)
    return `✅ *AskGogo Split created*\n\n*${group.name}*\nMembers: ${members.join(', ')}\n\nAdd your first expense like:\n_Add expense 2400 hotel paid by me in ${group.name} split equally_`
  }

  if (intent.type === 'add_equal_expense') {
    const group = await ensureGroup(phone, intent.groupName, intent.members)
    let members = intent.members.length ? intent.members : await getMembers(group.id)
    if (!members.length) members = ['Me', intent.paidBy]
    if (!members.some((m) => m.toLowerCase() === intent.paidBy.toLowerCase())) members.unshift(intent.paidBy)
    members = Array.from(new Set(members.map(normalizeMemberName).filter(Boolean)))
    await ensureGroup(phone, group.name, members)

    const perPerson = Math.round((intent.amount / members.length) * 100) / 100
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
      members.map((member) => ({ expense_id: expense.id, group_id: group.id, member_name: member, owed_amount: perPerson }))
    )

    const { balances } = await calculateBalances(group.id)
    const summary = Object.entries(balances).map(([name, balance]) => `${name}: ${balance >= 0 ? 'gets' : 'owes'} ${money(Math.abs(balance))}`).join('\n')
    return `✅ *Expense added to ${group.name}*\n\n${intent.description}\nTotal: *${money(intent.amount)}*\nPaid by: *${intent.paidBy}*\nSplit: ${members.length} people × ${money(perPerson)}\n\n*Current balance*\n${summary}\n\nSay: *simplify ${group.name}*`
  }

  if (intent.type === 'show_balance' || intent.type === 'simplify' || intent.type === 'share_chart' || intent.type === 'history') {
    const group = await findGroup(phone, intent.type === 'history' ? undefined : intent.groupName)
    if (!group) return `No split group found yet. Say: *Create trip Goa with Rahul, Priya, Meera*`
    const { balances, expenses } = await calculateBalances(group.id)

    if (intent.type === 'share_chart') {
      return `📊 *${group.name} expense chart*\n\nOpen/share this card:\n${APP_URL}/api/splitbill/chart/${group.id}\n\nSay *show balance ${group.name}* for details.`
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
    await supabaseAdmin.from('split_settlements').insert({
      group_id: group.id,
      from_member: intent.from,
      to_member: intent.to,
      amount: intent.amount,
      note: intent.rawText,
    })
    const { balances } = await calculateBalances(group.id)
    const suggestions = simplifyDebts(balances)
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
    const inviteLink = `${APP_URL}/split/join/${data?.invite_code || group.id}`
    return `✉️ *Invite ready*\n\nInvite ${intent.name} to *${group.name}*:\n${inviteLink}\n\nForward this message on WhatsApp. They can join and see the group summary.`
  }

  return null
}
