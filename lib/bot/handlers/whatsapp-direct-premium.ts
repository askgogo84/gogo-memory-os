import { buildWelcomeBack, HELP_MENU } from './welcome'

export type DirectWhatsappReply = {
  text: string
  mediaUrl?: string | null
  saveMemory?: string | null
}

export function isGreeting(input: string) {
  return /^(hi|hello|hey|start|\/start|hi askgogo|hello askgogo|hey askgogo|start askgogo|askgogo)$/i.test(String(input || '').trim().toLowerCase())
}

export function getDirectWhatsappPremiumReply(input: string, userName?: string): DirectWhatsappReply | null {
  const raw = (input || '').trim()
  const lower = raw.toLowerCase()

  if (isGreeting(lower)) {
    // Someone already using AskGogo (a new person gets the full intro from onboarding first).
    return { mediaUrl: null, text: buildWelcomeBack(userName) }
  }

  if (
    lower === 'help' ||
    lower === '/help' ||
    lower === 'menu' ||
    lower === 'commands' ||
    lower === 'what can you do' ||
    lower === 'features'
  ) {
    return { text: HELP_MENU }
  }

  // Referral commands are handled by referral-unlock.ts before this direct handler.
  return null
}
