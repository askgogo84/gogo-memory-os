export type BalanceMap = Record<string, number>

export type SettlementSuggestion = {
  from: string
  to: string
  amount: number
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function simplifyDebts(balances: BalanceMap): SettlementSuggestion[] {
  const debtors = Object.entries(balances)
    .filter(([, balance]) => balance < -0.01)
    .map(([name, balance]) => ({ name, amount: roundMoney(Math.abs(balance)) }))
    .sort((a, b) => b.amount - a.amount)

  const creditors = Object.entries(balances)
    .filter(([, balance]) => balance > 0.01)
    .map(([name, balance]) => ({ name, amount: roundMoney(balance) }))
    .sort((a, b) => b.amount - a.amount)

  const suggestions: SettlementSuggestion[] = []
  let i = 0
  let j = 0

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    const amount = roundMoney(Math.min(debtor.amount, creditor.amount))

    if (amount > 0.01) {
      suggestions.push({ from: debtor.name, to: creditor.name, amount })
    }

    debtor.amount = roundMoney(debtor.amount - amount)
    creditor.amount = roundMoney(creditor.amount - amount)

    if (debtor.amount <= 0.01) i++
    if (creditor.amount <= 0.01) j++
  }

  return suggestions
}
