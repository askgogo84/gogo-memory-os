import { searchWeb } from '@/lib/web-search'
import { askClaudeWithContext } from '@/lib/claude'
import { buildDirectWebAnswer } from './web-answer'

function hasUsableSearchResults(text: string) {
  return !!(text || '').trim()
}

export async function buildIplStandingsReply(userText: string, userName: string) {
  const primaryQuery = 'IPL 2026 points table standings'
  const fallbackQuery = 'current IPL table toppers'

  let context = await searchWeb(primaryQuery)

  if (!hasUsableSearchResults(context)) {
    context = await searchWeb(fallbackQuery)
  }

  if (!hasUsableSearchResults(context)) {
    return `I couldn't fetch the live IPL table right now. Try again in a moment.`
  }

  try {
    const reply = await askClaudeWithContext(
      userText,
      `Use these results to answer only about the IPL points table / table toppers.\n\n${context}`,
      userName
    )

    if (!reply || /i apologize|unable to provide|don't have access|couldn't fetch/i.test(reply)) {
      return buildDirectWebAnswer(userText, context)
    }

    return reply
  } catch {
    return buildDirectWebAnswer(userText, context)
  }
}
