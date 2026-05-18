import { supabaseAdmin } from '@/lib/supabase-admin'
import { normalizeMemberName } from './split-parser'
import type { ReceiptScanResult } from './receipt-reader'

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function money(value: number) {
  const rounded = roundMoney(value)
  return `₹${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2)}`
}

function cleanGroupName(value?: string | null) {
  const clean = String(value || '')
    .trim()
    .replace(/^in\s+/i, '')
    .replace(/^for\s+/i, '')
    .replace(/^of\s+/i, '')
    .replace(/^trip\s+/i, '')
    .replace(/^group\s+/i, '')
    .replace(/\s+/g, ' ')
  return clean || undefined
}

async function groupIdsForPhone(phone: string) {
  const { data } = await supabaseAdmin.from('split_group_members').select('group_id').eq('phone', phone)
  const ids = (data || []).map((row: any) => row.group_id).filter(Boolean)
  return ids.length ? ids.join(',') : '00000000-0000-0000-0000-000000000000'
}

async function findGroup(phone: string, groupName?: string | null) {
  const cleanName = cleanGroupName(groupName)
  const memberGroupIds = await groupIdsForPhone(phone)

  if (cleanName) {
    const exact = await supabaseAdmin
      .from('split_groups')
      .select('id,name,owner_phone,currency')
      .or(`owner_phone.eq.${phone},id.in.(${memberGroupIds})`)
      .ilike('name', cleanName)
      .order('created_at', { ascending: false })
      .limit(1)
    if (exact.data?.[0]) return exact.data[0]

    const fuzzy = await supabaseAdmin
      .from('split_groups')
      .select('id,name,owner_phone,currency')
      .or(`owner_phone.eq.${phone},id.in.(${memberGroupIds})`)
      .ilike('name', `%${cleanName}%`)
      .order('created_at', { ascending: false })
      .limit(1)
    if (fuzzy.data?.[0]) return fuzzy.data[0]
  }

  const latest = await supabaseAdmin
    .from('split_groups')
    .select('id,name,owner_phone,currency')
    .or(`owner_phone.eq.${phone},id.in.(${memberGroupIds})`)
    .order('updated_at', { ascending: false })
    .limit(1)

  return latest.data?.[0] || null
}

async function getMembers(groupId: string) {
  const { data } = await supabaseAdmin
    .from('split_group_members')
    .select('name,phone')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
  return (data || []).map((row: any) => ({ name: String(row.name), phone: row.phone as string | null }))
}

async function calculateBalances(groupId: string) {
  const { data: expenses } = await supabaseAdmin.from('split_expenses').select('total_amount,paid_by').eq('group_id', groupId)
  const { data: shares } = await supabaseAdmin.from('split_expense_shares').select('member_name,owed_amount').eq('group_id', groupId)
  const { data: settlements } = await supabaseAdmin.from('split_settlements').select('from_member,to_member,amount').eq('group_id', groupId)

  const balances: Record<string, number> = {}
  const add = (name: string, amount: number) => {
    const key = normalizeMemberName(name)
    balances[key] = roundMoney((balances[key] || 0) + amount)
  }

  for (const expense of expenses || []) add(expense.paid_by, Number(expense.total_amount || 0))
  for (const share of shares || []) add(share.member_name, -Number(share.owed_amount || 0))
  for (const settlement of settlements || []) {
    add(settlement.from_member, Number(settlement.amount || 0))
    add(settlement.to_member, -Number(settlement.amount || 0))
  }

  Object.keys(balances).forEach((name) => {
    if (Math.abs(balances[name]) < 0.01) balances[name] = 0
  })

  return balances
}

function balanceLines(balances: Record<string, number>) {
  return Object.entries(balances)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([name, balance]) => `${name}: ${balance >= 0 ? 'gets' : 'owes'} ${money(Math.abs(balance))}`)
    .join('\n') || 'All settled.'
}

export async function addScannedReceiptToSplit(params: {
  ownerPhone: string
  groupName?: string
  receipt: ReceiptScanResult
  rawCaption?: string
}) {
  const group = await findGroup(params.ownerPhone, params.groupName)
  if (!group) {
    return {
      reply: `I scanned the receipt, but couldn't find a split group.\n\nCreate one first: *Create trip ${params.groupName || 'Trip'} with Rahul, Priya*`,
      group: null,
      expense: null,
    }
  }

  const members = await getMembers(group.id)
  const memberNames = members.map((m) => m.name).filter(Boolean)
  const splitMembers = memberNames.length ? memberNames : ['Me']
  const perPerson = roundMoney(params.receipt.total / splitMembers.length)

  const { data: expense, error: expenseError } = await supabaseAdmin
    .from('split_expenses')
    .insert({
      group_id: group.id,
      description: params.receipt.merchant || 'Receipt',
      total_amount: params.receipt.total,
      paid_by: 'Me',
      category: 'food',
      currency: params.receipt.currency || 'INR',
      raw_text: params.rawCaption || 'split receipt',
    })
    .select('id')
    .single()

  if (expenseError) throw expenseError

  await supabaseAdmin.from('split_expense_shares').insert(
    splitMembers.map((member) => ({ expense_id: expense.id, group_id: group.id, member_name: member, owed_amount: perPerson }))
  )

  await supabaseAdmin.from('split_receipts').insert({
    owner_phone: params.ownerPhone,
    group_id: group.id,
    expense_id: expense.id,
    merchant: params.receipt.merchant || 'Receipt',
    total_amount: params.receipt.total,
    currency: params.receipt.currency || 'INR',
    items_json: params.receipt.items || [],
    raw_caption: params.rawCaption || null,
    status: 'scanned_equal_split',
  })

  await supabaseAdmin.from('split_groups').update({ updated_at: new Date().toISOString() }).eq('id', group.id)

  const balances = await calculateBalances(group.id)
  return {
    group,
    expense,
    reply:
      `✅ *Receipt saved to ${group.name}*\n\n` +
      `${params.receipt.merchant}\n` +
      `Total: *${money(params.receipt.total)}*\n` +
      `Paid by: *Me*\n` +
      `Split: ${splitMembers.length} people × ${money(perPerson)}\n\n` +
      `*Current balance*\n${balanceLines(balances)}\n\n` +
      `To split by items, say:\n` +
      `_itemize receipt Rahul had pizza, Priya had pasta_`,
  }
}

export function isReceiptItemizeCommand(text: string | null | undefined) {
  const lower = String(text || '').toLowerCase().trim()
  return lower.startsWith('itemize receipt') || lower.startsWith('split items') || lower.startsWith('assign items')
}

function normalizeForMatch(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseAssignments(text: string) {
  const cleaned = String(text || '')
    .replace(/^itemize receipt/i, '')
    .replace(/^split items/i, '')
    .replace(/^assign items/i, '')
    .trim()

  const assignments: { member: string; query: string }[] = []
  const regex = /([a-zA-Z][a-zA-Z\s]{0,30}?)\s+(?:had|ate|ordered|took|gets?|has)\s+([^,;]+)/gi
  let match: RegExpExecArray | null

  while ((match = regex.exec(cleaned)) !== null) {
    const member = normalizeMemberName(match[1])
    const rawItems = match[2]
      .split(/\band\b|\+/i)
      .map((item) => item.trim())
      .filter(Boolean)

    for (const item of rawItems) assignments.push({ member, query: item })
  }

  return assignments
}

function matchItemIndex(items: any[], query: string, usedIndexes: Set<number>) {
  const q = normalizeForMatch(query)
  if (!q) return -1

  let bestIndex = -1
  let bestScore = 0

  items.forEach((item, index) => {
    if (usedIndexes.has(index)) return
    const name = normalizeForMatch(item.name)
    if (!name) return

    let score = 0
    if (name.includes(q) || q.includes(name)) score = 100
    else {
      const qWords = q.split(' ').filter((w) => w.length > 2)
      const nameWords = name.split(' ').filter((w) => w.length > 2)
      score = qWords.filter((word) => nameWords.some((nw) => nw.includes(word) || word.includes(nw))).length * 20
    }

    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  })

  return bestScore >= 20 ? bestIndex : -1
}

export async function handleReceiptItemizeCommand(phone: string, text: string) {
  if (!isReceiptItemizeCommand(text)) return null

  const { data: receipt } = await supabaseAdmin
    .from('split_receipts')
    .select('id,group_id,expense_id,merchant,total_amount,items_json')
    .eq('owner_phone', phone)
    .not('expense_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!receipt) {
    return `No recent split receipt found.\n\nSend a bill photo with caption: *split receipt Goa Test* first.`
  }

  const items = Array.isArray(receipt.items_json) ? receipt.items_json : []
  if (!items.length) {
    return `I found the latest receipt, but no item lines were readable.\n\nYou can still add exact split manually, for example:\n_Dinner 3200 paid by Me, Rahul 1200, Priya 1000, Meera 1000_`
  }

  const assignments = parseAssignments(text)
  if (!assignments.length) {
    return `Tell me who had what, like:\n\n_itemize receipt Rahul had pizza, Priya had pasta, Meera had coke_`
  }

  const usedIndexes = new Set<number>()
  const memberTotals: Record<string, number> = {}
  const matchedLines: string[] = []
  const unmatchedQueries: string[] = []

  for (const assignment of assignments) {
    const index = matchItemIndex(items, assignment.query, usedIndexes)
    if (index < 0) {
      unmatchedQueries.push(`${assignment.member}: ${assignment.query}`)
      continue
    }

    usedIndexes.add(index)
    const item = items[index]
    const amount = Number(item.amount || 0)
    memberTotals[assignment.member] = roundMoney((memberTotals[assignment.member] || 0) + amount)
    matchedLines.push(`${assignment.member}: ${item.name} ${money(amount)}`)
  }

  const assignedSubtotal = Object.values(memberTotals).reduce((sum, value) => sum + value, 0)
  if (assignedSubtotal <= 0) {
    return `I couldn't confidently match those item names to the receipt.\n\nTry using item names closer to the bill, for example: *Rahul had Margherita Pizza*.`
  }

  const receiptTotal = Number(receipt.total_amount || assignedSubtotal)
  const multiplier = receiptTotal > 0 && assignedSubtotal > 0 ? receiptTotal / assignedSubtotal : 1
  const adjustedTotals = Object.fromEntries(Object.entries(memberTotals).map(([member, value]) => [member, roundMoney(value * multiplier)]))

  await supabaseAdmin.from('split_expense_shares').delete().eq('expense_id', receipt.expense_id)
  await supabaseAdmin.from('split_expense_shares').insert(
    Object.entries(adjustedTotals).map(([member, amount]) => ({
      expense_id: receipt.expense_id,
      group_id: receipt.group_id,
      member_name: member,
      owed_amount: amount,
    }))
  )

  await supabaseAdmin.from('split_receipts').update({ status: 'itemized', updated_at: new Date().toISOString() }).eq('id', receipt.id)
  await supabaseAdmin.from('split_groups').update({ updated_at: new Date().toISOString() }).eq('id', receipt.group_id)

  const balances = await calculateBalances(receipt.group_id)
  const itemizedLines = Object.entries(adjustedTotals).map(([member, amount]) => `${member}: ${money(amount)}`).join('\n')

  return (
    `✅ *Receipt itemized*\n\n` +
    `${receipt.merchant}\n` +
    `Total: *${money(receiptTotal)}*\n\n` +
    `*Matched items*\n${matchedLines.join('\n')}\n\n` +
    `*Updated split*\n${itemizedLines}\n` +
    `${unmatchedQueries.length ? `\nCould not match:\n${unmatchedQueries.map((item) => `• ${item}`).join('\n')}\n` : ''}` +
    `\n*Current balance*\n${balanceLines(balances)}`
  )
}
