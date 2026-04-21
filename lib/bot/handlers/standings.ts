import { searchWeb } from '@/lib/web-search'
import { askClaudeWithContext } from '@/lib/claude'

export async function buildIplStandingsReply(userText: string, userName: string) {
  const query =
    'IPL 2026 points table current standings top teams site:iplt20.com OR site:espncricinfo.com OR site:cricbuzz.com'

  const context = await searchWeb(query)

  return askClaudeWithContext(
    userText,
    `Use these results to answer only about the IPL points table / table toppers.\n\n${context}`,
    userName
  )
}
