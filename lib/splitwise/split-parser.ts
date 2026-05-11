export type SplitIntent =
  | { type: 'create_group'; groupName: string; members: string[] }
  | { type: 'add_equal_expense'; groupName?: string; amount: number; description: string; paidBy: string; members: string[]; rawText: string }
  | { type: 'show_balance'; groupName?: string }
  | { type: 'simplify'; groupName?: string }
  | { type: 'settle'; groupName?: string; from: string; to: string; amount: number; rawText: string }
  | { type: 'share_chart'; groupName?: string }
  | { type: 'invite'; groupName?: string; name: string; phone?: string }
  | { type: 'history'; groupName?: string }
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
  const clean = String(value || '').trim().replace(/^in\s+/i, '').replace(/\s+/g, ' ')
  return clean || undefined
}

export function parseSplitIntent(input: string): SplitIntent {
  const text = String(input || '').trim()
  const lower = text.toLowerCase().trim()

  if (!text) return null

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

  const balanceMatch = text.match(/^(?:show\s+)?(?:balance|balances|who owes who|who owes whom)(?:\s+(?:for|in)\s+(.+))?$/i)
  if (balanceMatch) return { type: 'show_balance', groupName: cleanGroupName(balanceMatch[1]) }

  const simplifyMatch = text.match(/^(?:simplify|settlement|settlements|simplify settlement|simplify debts)(?:\s+(?:for|in)\s+(.+))?$/i)
  if (simplifyMatch) return { type: 'simplify', groupName: cleanGroupName(simplifyMatch[1]) }

  const chartMatch = text.match(/^(?:share|show|create|generate)?\s*(?:expense\s*)?(?:chart|summary card|split chart)(?:\s+(?:for|in)\s+(.+))?$/i)
  if (chartMatch) return { type: 'share_chart', groupName: cleanGroupName(chartMatch[1]) }

  const amount = parseAmount(text)
  const expenseLike = /\b(split|expense|paid|spent|add expense|bill|cab|hotel|dinner|lunch|breakfast|fuel|stay|tickets?)\b/i.test(text)
  if (amount && expenseLike) {
    const paidMatch = text.match(/paid\s+by\s+([a-zA-Z][\w\s]*?)(?:\s+(?:split|with|among|between|in|for)|$)/i)
    const paidBy = normalizeMemberName(paidMatch?.[1] || (/\bpaid\b/i.test(text) ? 'Me' : 'Me'))

    const inMatch = text.match(/\s+in\s+([a-zA-Z][\w\s-]*?)(?:\s+split|\s+with|\s+among|\s+between|$)/i)
    const groupName = cleanGroupName(inMatch?.[1])

    const membersMatch = text.match(/(?:split\s+(?:equally\s+)?(?:with|among|between)|with|among|between)\s+(.+?)(?:\s+for\s+|\s+in\s+|$)/i)
    let members = splitMembers(membersMatch?.[1] || '')
    if (!members.length || /\ball\b/i.test(membersMatch?.[1] || '')) members = []
    if (members.length && !members.some((m) => m.toLowerCase() === paidBy.toLowerCase())) members.unshift(paidBy)

    let description = text
      .replace(/(?:rs\.?|inr|₹)?\s*\d+(?:\.\d+)?/i, '')
      .replace(/paid\s+by\s+[a-zA-Z][\w\s]*/i, '')
      .replace(/split\s+(?:equally\s+)?(?:with|among|between).*/i, '')
      .replace(/\s+in\s+[a-zA-Z][\w\s-]*/i, '')
      .replace(/^(add expense|expense|spent|paid|split|bill)\s*/i, '')
      .trim()

    if (!description) description = 'Expense'

    return { type: 'add_equal_expense', amount, description, paidBy, members, groupName, rawText: text }
  }

  return null
}
