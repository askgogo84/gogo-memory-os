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

async function groupIdsForPhone(phone: string) {
  const { data } = await supabaseAdmin
    .from('split_group_members')
    .select('group_id')
    .eq('phone', phone)
  const ids = (data || []).map((row: any) => row.group_id).filter(Boolean)
  return ids.length ? ids.join(',') : '00000000-0000-0000-0000-000000000000'
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

async function findGroup(phone: string, groupName?: string): Promise<Group | null> {
  const memberGroupIds = await groupIdsForPhone(phone)
  if (!groupName) return getLatestGroup(phone)

  // If multiple trips have the same name, prefer the newest exact-created group.
  // This avoids old trips being reused just because they had a recent update.
  const exact = await supabaseAdmin
    .from('split_groups')
    .select('id,name,owner_phone,currency')
    .or(`owner_phone.eq.${phone},id.in.(${memberGroupIds})`)
    .ilike('name', groupName)
    .order('created_at', { ascending: false })
    .limit(1)

  if (exact.data?.[0]) return exact.data[0] as Group

  const fuzzy = await supabaseAdmin
    .from('split_groups')
    .select('id,name,owner_phone,currency')
    .or(`owner_phone.eq.${phone},id.in.(${memberGroupIds})`)
    .ilike('name', `%${groupName}%`)
    .order('created_at', { ascending: false })
    .limit(1)

  return (fuzzy.data?.[0] as Group) || null
}

async function nextFreshGroupName(phone: string, requestedName: string) {
  const { data } = await supabaseAdmin
    .from('split_groups')
    .select('name')
    .eq('owner_phone', phone)
    .ilike('name', `${requestedName}%`)

  const existing = new Set((data || []).map((row: any) => String(row.name || '').toLowerCase()))
  if (!existing.has(requestedName.toLowerCase())) return requestedName

  let index = 2
  while (existing.has(`${requestedName} #${index}`.toLowerCase())) index++
  return `${requestedName} #${index}`
}

async function insertGroup(phone: string, groupName: string, members: string[] = []) {
  const { data, error } = await supabaseAdmin
    .from('split_groups')
    .insert({ owner_phone: phone, name: groupName, currency: 'INR' })
    .select('id,name,owner_phone,currency')
    .single()
  if (error) throw error
  const group = data as Group
  await upsertMembers(group.id, phone, members)
  return group
}

async function createFreshGroup(phone: string, groupName: string, members: string[] = []) {
  const freshName = await nextFreshGroupName(phone, groupName)
  return insertGroup(phone, freshName, members)
}

async function upsertMembers(groupId: string, phone: string, members: string[] = []) {
  const normalized = Array.from(new Set(['Me', ...members.map(normalizeMemberName).filter(Boolean)]))
  if (!normalized.length) return
  await supabaseAdmin.from('split_group_members').upsert(
    normalized.map((name) => ({ group_id: groupId, name, phone: name === 'Me' ? phone : null })),
    { onConflict: 'group_id,name' }
  )
}

async function ensureGroup(phone: string, groupName?: string, members: string[] = []) {
  let group = await findGroup(phone, groupName)
  if (!group) group = await insertGroup(phone, groupName || 'My Split Group', members)
  else await upsertMembers(group.id, phone, members)

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
    if (Math.abs(total - params.amount) > 1) throw new Error(`Unequal split total is ${money(total)}, but expense is ${money(params.amount)}.`)
    return params.allocations.map((item) => ({ member: normalizeMemberName(item.member), owedAmount: roundMoney(Number(item.value)) }))
  }

  if (params.splitMode === 'percent') {
    const totalPercent = roundMoney(params.allocations.reduce((sum, item) => sum + Number(item.value || 0), 0))
    if (Math.abs(totalPercent - 100) > 0.5) throw new Error(`Percentage split totals ${totalPercent}%, but should be 100%.`)
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

async function createInvite(groupId: string, invitedName: string, phone?: string | null) {
  const { data, error } = await supabaseAdmin
    .from('split_invites')
    .insert({ group_id: groupId, invited_name: invitedName, invited_phone: phone || null })
    .select('invite_code')
    .single()
  if (error) throw error
  return data?.invite_code as string
}

function memberNameForJoin(invitedName: string, phone: string) {
  const normalized = normalizeMemberName(invitedName)
  if (!normalized || /^(friend|guest|member)$/i.test(normalized)) return `Member ${phone.slice(-4)}`
  return normalized
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

    const memberName = memberNameForJoin(invite.invited_name, phone)
    await supabaseAdmin.from('split_group_members').upsert({ group_id: invite.group_id, name: memberName, phone }, { onConflict: 'group_id,name' })
    await supabaseAdmin.from('split_invites').update({ status: 'joined', invited_phone: phone }).eq('id', invite.id)

    const { data: group } = await supabaseAdmin.from('split_groups').select('id,name').eq('id', invite.group_id).single()
    await notifyLinkedMembers(invite.group_id, phone, `🔔 *${memberName} joined ${group?.name || 'the split'}*\n\nThey can now add expenses and see balances from their own WhatsApp.`)

    return `✅ *Joined ${group?.name || 'split group'}*\n\nYou can now add expenses here.\nTry: *Add expense 500 lunch paid by me split equally*`
  }

  if (intent.type === 'create_group') {
    const group = await createFreshGroup(phone, intent.groupName, intent.members)
    const groupMembers = await getMembers(group.id)
    // Generate a universal WhatsApp-shareable invite link
    const inviteCode = await createInvite(group.id, 'Friend', null)
    const joinUrl = `${APP_URL}/join/${inviteCode}`
    const waText = `Hey! Join my *${group.name}* trip split on AskGogo WhatsApp AI.\n\nTap to join → ${joinUrl}\n\nYou can add expenses, see balances & settle up — all on WhatsApp!`
    const waLink = waDeepLink(waText)
    const memberList = groupMembers.map((m) => m.name).join(', ')
    return `✅ *${group.name}* created!

👥 Members: ${memberList}

📎 *Share this with your group on WhatsApp:*
${joinUrl}

👆 Anyone who taps this link can join and add expenses from their own WhatsApp.

[Share invite on WhatsApp](${waLink})

Start adding:
_Add expense 2400 hotel paid by me split equally_`
  }

  if (intent.type === 'add_equal_expense') {
    const group = await ensureGroup(phone, intent.groupName, intent.members)
    const existingMembers = (await getMembers(group.id)).map((m) => m.name)
    const shareRows = computeShares({ amount: intent.amount, paidBy: intent.paidBy, members: intent.members.length ? intent.members : existingMembers, allocations: intent.allocations, splitMode: intent.splitMode })
    const members = shareRows.map((row) => row.member)
    await ensureGroup(phone, group.name, members)

    const { data: expense, error } = await supabaseAdmin
      .from('split_expenses')
      .insert({ group_id: group.id, description: intent.description, total_amount: intent.amount, paid_by: intent.paidBy, category: guessCategory(intent.description), currency: 'INR', raw_text: intent.rawText })
      .select('id')
      .single()
    if (error) throw error

    await supabaseAdmin.from('split_expense_shares').insert(shareRows.map((row) => ({ expense_id: expense.id, group_id: group.id, member_name: row.member, owed_amount: row.owedAmount })))

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
      const inviteCode = await createInvite(group.id, 'Guest')
      const askGogoLink = waDeepLink(`join split ${inviteCode}`)
      return `📊 *${group.name} expense chart*\n\nOpen/share this card:\n${APP_URL}/api/splitbill/chart/${group.id}\n\nInvite friends through AskGogo WhatsApp:\n${askGogoLink}\n\nAnyone who joins can add expenses to the same tracker from their WhatsApp.`
    }

    if (intent.type === 'history') {
      if (!expenses.length) return `No expenses yet. Add one like: *Add expense 2400 hotel paid by me split equally*`
      const recent = expenses.slice(-5).reverse().map((expense) => `• ${money(Number(expense.total_amount))} ${expense.description} — paid by ${expense.paid_by}`).join('\n')
      return `🧾 *Recent split expenses*\n\n*${group.name}*\n${recent}`
    }

    const balanceLines = Object.entries(balances).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([name, balance]) => `${name}: ${balance >= 0 ? 'gets' : 'owes'} ${money(Math.abs(balance))}`).join('\n') || 'All settled.'
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
    const inviteCode = await createInvite(group.id, intent.name, intent.phone || null)
    const askGogoLink = waDeepLink(`join split ${inviteCode}`)
    const directMessage = `Hey ${intent.name}, join our *${group.name}* expense tracker on AskGogo:\n${askGogoLink}\n\nOnce it opens, just send the prefilled message.`

    if (intent.phone) await sendWhatsAppMessage(intent.phone, directMessage).catch((error: any) => console.error('[split-invite] direct send failed:', error?.message || error))

    return `✉️ *Invite ready*\n\nInvite ${intent.name} to *${group.name}*:\n${askGogoLink}\n\n${intent.phone ? 'I also tried sending it directly on WhatsApp.' : 'Forward this link to them on WhatsApp.'}\n\nAfter joining, their expenses will update the same tracker and linked members will get updates.`
  }

  // ── Trip summary by category ──────────────────────────────────
  if (intent.type === 'trip_summary') {
    const group = await findGroup(phone, intent.groupName)
    if (!group) return `No trip found. Create one with: *Create trip Goa with Rahul, Priya*`
    const { expenses } = await calculateBalances(group.id)
    if (!expenses.length) return `No expenses in *${group.name}* yet.`
    const byCategory: Record<string, number> = {}
    expenses.forEach((e: Expense) => {
      const cat = guessCategory(e.description)
      byCategory[cat] = roundMoney((byCategory[cat] || 0) + Number(e.total_amount))
    })
    const total = roundMoney(expenses.reduce((s: number, e: Expense) => s + Number(e.total_amount), 0))
    const lines = Object.entries(byCategory)
      .sort(([, a], [, b]) => b - a)
      .map(([cat, amt]) => {
        const icons: Record<string, string> = { food: '🍽', travel: '✈', stay: '🏨', activity: '🎭', recurring: '🔄', general: '📦' }
        const pct = Math.round((amt / total) * 100)
        return `${icons[cat] || '📦'} ${cat.charAt(0).toUpperCase() + cat.slice(1)}: ${money(amt)} (${pct}%)`
      })
    const members = await getMembers(group.id)
    const perPerson = members.length > 1 ? `
Per person avg: ${money(roundMoney(total / members.length))}` : ''
    return `📊 *${group.name} · Trip Summary*

${lines.join('
')}

💰 *Total spent: ${money(total)}*${perPerson}

For settlement: *simplify ${group.name}*`
  }

  // ── Remind debtors via WhatsApp ────────────────────────────────
  if (intent.type === 'remind_debtors') {
    const group = await findGroup(phone, intent.groupName)
    if (!group) return `No trip found.`
    const { balances } = await calculateBalances(group.id)
    const debtors = Object.entries(balances).filter(([, b]) => b < -0.01)
    if (!debtors.length) return `✅ Everyone is settled up in *${group.name}*!`
    const members = await getMembers(group.id)
    let notified = 0
    for (const [name, balance] of debtors) {
      const member = members.find(m => m.name.toLowerCase() === name.toLowerCase())
      if (member?.phone && member.phone !== phone) {
        await sendWhatsAppMessage(member.phone,
          `💰 *${group.name} · Settlement Reminder*

Hey ${name}! You owe ${money(Math.abs(balance))} in the *${group.name}* split.

Send it to the person you owe and mark it settled:
*${name} paid [person] ₹[amount] in ${group.name}*`
        )
        notified++
      }
    }
    const debtorList = debtors.map(([n, b]) => `• ${n}: owes ${money(Math.abs(b))}`).join('
')
    return `🔔 *Reminders sent in ${group.name}*

${debtorList}

${notified} member${notified !== 1 ? 's' : ''} notified on WhatsApp.`
  }

  // ── Set budget per person ──────────────────────────────────────
  if (intent.type === 'set_budget') {
    const group = await findGroup(phone, intent.groupName)
    if (!group) return `No trip found. Create one first with: *Create trip Goa with Rahul, Priya*`
    await supabaseAdmin.from('split_groups').update({ budget_per_person: intent.perPerson }).eq('id', group.id)
    const { expenses } = await calculateBalances(group.id)
    const members = await getMembers(group.id)
    const totalSpent = expenses.reduce((s: number, e: Expense) => s + Number(e.total_amount), 0)
    const spentPerPerson = members.length > 0 ? roundMoney(totalSpent / members.length) : 0
    const remaining = roundMoney(intent.perPerson - spentPerPerson)
    const pct = intent.perPerson > 0 ? Math.round((spentPerPerson / intent.perPerson) * 100) : 0
    return `🎯 *Budget set for ${group.name}*

Budget per person: ${money(intent.perPerson)}
Spent per person so far: ${money(spentPerPerson)} (${pct}%)
${remaining >= 0 ? `✅ Remaining: ${money(remaining)} per person` : `⚠️ Over budget by: ${money(Math.abs(remaining))} per person`}`
  }

  // ── Who owes me ───────────────────────────────────────────────
  if (intent.type === 'who_owes_me') {
    const group = await findGroup(phone, intent.groupName)
    if (!group) return `No trip found.`
    const { balances, expenses } = await calculateBalances(group.id)
    const members = await getMembers(group.id)
    const myMember = members.find(m => m.phone === phone)
    const myName = myMember?.name || 'Me'
    const simplified = simplifyDebts(balances)
    const owedToMe = simplified.filter(s => s.to.toLowerCase() === myName.toLowerCase())
    if (!owedToMe.length) return `✅ Nobody owes you anything in *${group.name}* right now.`
    const lines = owedToMe.map(s => `• ${s.from} owes you *${money(s.amount)}*`)
    const total = roundMoney(owedToMe.reduce((s, x) => s + x.amount, 0))
    return `💰 *Who owes you in ${group.name}*

${lines.join('
')}

Total owed to you: *${money(total)}*

To remind them: *remind everyone in ${group.name}*`
  }

  // ── Scan receipt prompt ───────────────────────────────────────
  if (intent.type === 'scan_receipt') {
    const group = await findGroup(phone, intent.groupName)
    const groupHint = group ? ` for *${group.name}*` : ''
    return `📸 *Scan Receipt${groupHint}*

Send a clear photo of the bill/receipt and I'll read it and split it automatically.

Add caption: *receipt ${group?.name || 'Goa'}* when you send the photo.`
  }

  return null
}
