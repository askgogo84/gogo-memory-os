export type SplitAllocation = {
  member: string
  value: number
}

export type SplitMode = 'equal' | 'unequal' | 'percent' | 'shares'

export type SplitIntent =
  | { type: 'create_group'; groupName: string; members: string[] }
  | { type: 'join'; inviteCode: string }
  | {
      type: 'add_equal_expense'
      groupName?: string
      amount: number
      description: string
      paidBy: string
      members: string[]
      splitMode: SplitMode
      allocations: SplitAllocation[]
      rawText: string
    }
  | { type: 'show_balance'; groupName?: string }
  | { type: 'simplify'; groupName?: string }
  | { type: 'settle'; groupName?: string; from: string; to: string; amount: number; rawText: string }
  | { type: 'share_chart'; groupName?: string }
  | { type: 'invite'; groupName?: string; name: string; phone?: string }
  | { type: 'history'; groupName?: string }
  | { type: 'trip_summary'; groupName?: string }
  | { type: 'remind_debtors'; groupName?: string }
  | { type: 'set_budget'; groupName?: string; perPerson: number }
  | { type: 'who_owes_me'; groupName?: string }
  | { type: 'scan_receipt'; groupName?: string }
  | null

export function normalizeMemberName(value: string) {
  const clean = String(value || '').trim().replace(/^@+/, '')
  if (!clean) return ''
  if (/^(me|myself|i)$/i.test(clean)) return 'Me'
  return clean
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

function splitMembers(value: string) {
  return String(value || '')
    .split(/,|\band\b|\+|&/i)
    .map(normalizeMemberName)
    .filter(Boolean)
}

function parseAmount(text: string) {
  const amountMatch = text.match(/(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)/i)
  return amountMatch ? Number(amountMatch[1]) : null
}

function cleanGroupName(value?: string) {
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

function parseAllocationSegments(text: string) {
  const afterComma = text.includes(',') ? text.split(',').slice(1).join(',') : ''
  const afterSplit = text.match(/\bsplit\s+(?:as|by|between|among|with)?\s*(.+)$/i)?.[1] || ''
  const allocationText = afterComma || afterSplit

  const segments = allocationText
    .split(/,|\band\b|\+/i)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .filter((segment) => !/paid\s+by|\bin\s+[a-z]/i.test(segment))

  const percent: SplitAllocation[] = []
  const shares: SplitAllocation[] = []
  const unequal: SplitAllocation[] = []

  for (const segment of segments) {
    const percentMatch = segment.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*%$/i)
    if (percentMatch) {
      percent.push({ member: normalizeMemberName(percentMatch[1]), value: Number(percentMatch[2]) })
      continue
    }

    const shareMatch = segment.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*shares?$/i)
    if (shareMatch) {
      shares.push({ member: normalizeMemberName(shareMatch[1]), value: Number(shareMatch[2]) })
      continue
    }

    const amountMatch = segment.match(/^(.+?)\s+(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)$/i)
    if (amountMatch) {
      unequal.push({ member: normalizeMemberName(amountMatch[1]), value: Number(amountMatch[2]) })
    }
  }

  if (percent.length) return { splitMode: 'percent' as SplitMode, allocations: percent.filter((a) => a.member) }
  if (shares.length) return { splitMode: 'shares' as SplitMode, allocations: shares.filter((a) => a.member) }
  if (unequal.length) return { splitMode: 'unequal' as SplitMode, allocations: unequal.filter((a) => a.member) }
  return { splitMode: 'equal' as SplitMode, allocations: [] }
}

function extractDescription(text: string) {
  let cleaned = text.trim()

  // Keep only the part before allocation details after the first comma.
  if (cleaned.includes(',')) cleaned = cleaned.split(',')[0]

  cleaned = cleaned
    .replace(/(?:rs\.?|inr|₹)?\s*\d+(?:\.\d+)?/i, '')
    .replace(/paid\s+by\s+[a-zA-Z][\w\s]*?(?=\s+in\s+|\s+split\s+|$)/i, '')
    .replace(/\s+in\s+[a-zA-Z][\w\s-]*$/i, '')
    .replace(/split\s+(?:equally\s+)?(?:with|among|between|as|by).*/i, '')
    .replace(/^(add expense|expense|spent|paid|split|bill)\s*/i, '')
    .replace(/\bshares?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || 'Expense'
}

export function parseSplitIntent(input: string): SplitIntent {
  const text = String(input || '').trim()
  const lower = text.toLowerCase().trim()

  if (!text) return null

  const joinMatch = text.match(/^(?:join|accept)\s+(?:split\s+)?([a-f0-9]{8,32})$/i)
  if (joinMatch) return { type: 'join', inviteCode: joinMatch[1] }

  const createMatch = text.match(/^(?:create|start|new)\s+(?:group|trip|event)\s+(.+?)(?:\s+with\s+(.+))?$/i)
  if (createMatch) {
    const groupName = cleanGroupName(createMatch[1]) || 'Split Group'
    const members = splitMembers(createMatch[2] || '')
    if (!members.some((member) => /^me$/i.test(member))) members.unshift('Me')
    return { type: 'create_group', groupName, members }
  }

  const inviteMatch = text.match(/^invite\s+([a-zA-Z][\w\s]*?)(?:\s+(\+?\d{8,15}))?(?:\s+to\s+(.+))?$/i)
  if (inviteMatch) {
    return {
      type: 'invite',
      name: normalizeMemberName(inviteMatch[1]),
      phone: inviteMatch[2],
      groupName: cleanGroupName(inviteMatch[3]),
    }
  }

  const settleMatch = text.match(/^(?:settle\s+)?([a-zA-Z][\w\s]*?)\s+(?:paid|sent|gave)\s+([a-zA-Z][\w\s]*?)\s+(?:rs\.?|inr|₹)?\s*(\d+(?:\.\d+)?)(?:\s+in\s+(.+))?$/i)
  if (settleMatch) {
    return {
      type: 'settle',
      from: normalizeMemberName(settleMatch[1]),
      to: normalizeMemberName(settleMatch[2]),
      amount: Number(settleMatch[3]),
      groupName: cleanGroupName(settleMatch[4]),
      rawText: text,
    }
  }

  if (/^(my splits?|past splits?|split history|recent splits?)$/i.test(lower)) return { type: 'history' }

  const balanceMatch = text.match(/^(?:show\s+)?(?:balance|balances|who owes who|who owes whom)(?:\s+(?:(?:for|in|of)\s+)?(.+))?$/i)
  if (balanceMatch) return { type: 'show_balance', groupName: cleanGroupName(balanceMatch[1]) }

  const reverseBalanceMatch = text.match(/^(.+?)\s+(?:balance|balances)$/i)
  if (reverseBalanceMatch) return { type: 'show_balance', groupName: cleanGroupName(reverseBalanceMatch[1]) }

  const simplifyMatch = text.match(/^(?:simplify|settlement|settlements|simplify settlement|simplify debts)(?:\s+(?:(?:for|in|of)\s+)?(.+))?$/i)
  if (simplifyMatch) return { type: 'simplify', groupName: cleanGroupName(simplifyMatch[1]) }

  const reverseSimplifyMatch = text.match(/^(.+?)\s+(?:settlement|settlements|simplify|simplified settlement)$/i)
  if (reverseSimplifyMatch) return { type: 'simplify', groupName: cleanGroupName(reverseSimplifyMatch[1]) }

  const chartMatch = text.match(/^(?:share|show|create|generate)?\s*(?:expense\s*)?(?:chart|summary card|split chart)(?:\s+(?:(?:for|in|of)\s+)?(.+))?$/i)
  if (chartMatch) return { type: 'share_chart', groupName: cleanGroupName(chartMatch[1]) }

  const reverseChartMatch = text.match(/^(.+?)\s+(?:chart|summary card|split chart)$/i)
  if (reverseChartMatch) return { type: 'share_chart', groupName: cleanGroupName(reverseChartMatch[1]) }

  const amount = parseAmount(text)
  const expenseLike = /\b(split|expense|paid|spent|add expense|bill|cab|hotel|dinner|lunch|breakfast|fuel|stay|tickets?|rent)\b/i.test(text)
  if (amount && expenseLike) {
    const paidMatch = text.match(/paid\s+by\s+([a-zA-Z][\w\s]*?)(?:\s+(?:split|with|among|between|in|for)|,|$)/i)
    const paidBy = normalizeMemberName(paidMatch?.[1] || (/\bpaid\b/i.test(text) ? 'Me' : 'Me'))

    const inMatch = text.match(/\s+in\s+([a-zA-Z][\w\s-]*?)(?:\s+split|\s+with|\s+among|\s+between|,|$)/i)
    const groupName = cleanGroupName(inMatch?.[1])

    const allocationResult = parseAllocationSegments(text)
    const membersMatch = text.match(/(?:split\s+(?:equally\s+)?(?:with|among|between)|with|among|between)\s+(.+?)(?:\s+for\s+|\s+in\s+|$)/i)
    let members = splitMembers(membersMatch?.[1] || '')

    if (allocationResult.allocations.length) members = allocationResult.allocations.map((a) => a.member)
    if (!members.length || /\ball\b/i.test(membersMatch?.[1] || '')) members = []
    if (allocationResult.splitMode === 'equal' && members.length && !members.some((m) => m.toLowerCase() === paidBy.toLowerCase())) members.unshift(paidBy)

    return {
      type: 'add_equal_expense',
      amount,
      description: extractDescription(text),
      paidBy,
      members,
      groupName,
      splitMode: allocationResult.splitMode,
      allocations: allocationResult.allocations,
      rawText: text,
    }
  }

  // Trip summary
  if (/^(trip summary|expense summary|category breakdown|show categories|spending breakdown)(?:\s+(.+))?$/i.test(lower)) {
    const m = lower.match(/(?:trip summary|expense summary|category breakdown|show categories|spending breakdown)(?:\s+(.+))?$/i)
    return { type: 'trip_summary', groupName: cleanGroupName(m?.[1]) }
  }

  // Remind debtors
  if (/^(remind|nudge|ping)\s+(everyone|all|debtors|members)(?:\s+(?:in|for|about)\s+(.+))?$/i.test(lower)) {
    const m = lower.match(/(?:remind|nudge|ping)\s+(?:everyone|all|debtors|members)(?:\s+(?:in|for|about)\s+(.+))?$/i)
    return { type: 'remind_debtors', groupName: cleanGroupName(m?.[1]) }
  }

  // Set budget
  const budgetMatch = lower.match(/^(?:set\s+)?budget\s+(?:rs\.?|inr|₹)?(\d+(?:\.\d+)?)(?:\s+(?:per\s+person)?)?(?:\s+(?:in|for)\s+(.+))?$/i)
  if (budgetMatch) {
    return { type: 'set_budget', perPerson: Number(budgetMatch[1]), groupName: cleanGroupName(budgetMatch[2]) }
  }

  // Who owes me
  if (/^(who owes me|my receivables?|owed to me)(?:\s+(?:in|for)\s+(.+))?$/i.test(lower)) {
    const m = lower.match(/(?:who owes me|my receivables?|owed to me)(?:\s+(?:in|for)\s+(.+))?$/i)
    return { type: 'who_owes_me', groupName: cleanGroupName(m?.[1]) }
  }

  // Scan receipt
  if (/^(scan receipt|read receipt|add receipt)(?:\s+(?:in|for)\s+(.+))?$/i.test(lower)) {
    const m = lower.match(/(?:scan receipt|read receipt|add receipt)(?:\s+(?:in|for)\s+(.+))?$/i)
    return { type: 'scan_receipt', groupName: cleanGroupName(m?.[1]) }
  }

  return null
}
