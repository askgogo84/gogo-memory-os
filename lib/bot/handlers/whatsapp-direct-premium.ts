import { buildWelcomeBack, HELP_MENU } from './welcome'

export type DirectWhatsappReply = {
  text: string
  mediaUrl?: string | null
  saveMemory?: string | null
}

/** "Hi", "hello!", "hey gogo" — trailing punctuation and a name after the greeting are fine. */
export function isGreeting(input: string) {
  const t = String(input || '').trim().toLowerCase().replace(/[\s!.?,]+$/g, '')
  return /^(?:hi+|hello|hey|hii|hola|namaste|start|\/start)(?:\s+(?:there|askgogo|gogo))?$|^askgogo$/i.test(t)
}

/** "help", "What can you do?", "show me the menu" — the help menu on WhatsApp and the dashboard. */
export function isHelpAsk(input: string) {
  const t = String(input || '').trim().toLowerCase().replace(/[\s!.?,]+$/g, '').replace(/^(?:please|pls|hey gogo|gogo)[,\s]+/, '')
  return /^(?:\/?help|menu|commands|features|what (?:all )?can (?:you|askgogo|gogo) do(?: for me)?|what do you do|how do (?:i|you) use (?:you|askgogo|this)|show (?:me )?(?:the )?(?:help|menu|features|commands)|what are your features)$/.test(t)
}

export function getDirectWhatsappPremiumReply(input: string, userName?: string): DirectWhatsappReply | null {
  const raw = (input || '').trim()
  const lower = raw.toLowerCase()

  if (isGreeting(lower)) {
    // Someone already using AskGogo (a new person gets the full intro from onboarding first).
    return { mediaUrl: null, text: buildWelcomeBack(userName) }
  }

  if (isHelpAsk(raw)) {
    return { text: HELP_MENU }
  }

  // Referral commands are handled by referral-unlock.ts before this direct handler.
  return null
}
