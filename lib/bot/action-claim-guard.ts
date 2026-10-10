// Free-form chat can only talk. It never starts, approves, submits or books anything, so it must
// never say it did. 10 Oct live run: after an account question went unrecognised, general chat
// wrote its own "Reply APPROVE to continue", then answered "Approve" with "Gogo is running it in
// the secure browser now" while nothing was running. Pure.

const FAKE_ACTION_CLAIMS: RegExp[] = [
  /\breply\s+\*?approve\*?\b/i,
  /\b(?:running|started|starting|launched)\s+(?:it\s+|this\s+|the\s+task\s+)?in\s+the\s+secure\s+browser\b/i,
  /\bsecure\s+browser\s+(?:is\s+)?(?:now\s+)?(?:running|working|open)\b/i,
  /^\W*approved\b/i,
  /\bgogo\s+is\s+(?:now\s+)?(?:running|working\s+on|creating|booking|submitting|signing\s+you\s+up)\b/i,
  /\b(?:i(?:'ve| have)|gogo\s+has|i)\s+(?:successfully\s+)?(?:created\s+(?:the|your)\s+[\w .-]{0,40}account|signed\s+you\s+up|submitted\s+(?:the|your)\s+(?:form|application|request)|placed\s+(?:the|your)\s+order|booked\s+(?:the|your|a)\b|purchased\b|cancell?ed\s+(?:the|your)\s+(?:subscription|booking|order))/i,
  /\bwill\s+message\s+you\s+the\s+result\b/i,
]

export const NO_ACTION_REPLY =
  "Nothing has been started. Gogo only runs a task after it sends you a real approval request for it, and there isn't one waiting. Send the request again in one message (for example: create a Hugging Face account for you@example.com) and I'll set it up."

export function claimsUnperformedAction(reply: string): boolean {
  const text = String(reply || '')
  return FAKE_ACTION_CLAIMS.some((re) => re.test(text))
}

/** Replace a chat reply that claims an action Gogo did not take. */
export function guardChatActionClaims(reply: string): { text: string; blocked: boolean } {
  if (!claimsUnperformedAction(reply)) return { text: reply, blocked: false }
  return { text: NO_ACTION_REPLY, blocked: true }
}
