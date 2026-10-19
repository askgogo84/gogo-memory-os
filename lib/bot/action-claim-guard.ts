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
  // Muse case 16 (11 Oct): chat replied "I'll check Tata Motors every 6 hours starting 7:05 am"
  // and no watch existed. Chat cannot schedule anything, so it may not promise ongoing work.
  /\b(?:i(?:'ll| will)|gogo\s+will)\s+(?:keep\s+(?:checking|an\s+eye|watching|tracking)|check|monitor|watch|track|ping|alert|notify|remind)\b[^.?!\n]{0,80}\b(?:every|each|daily|hourly|weekly|when(?:ever)?|if|as\s+soon\s+as|starting)\b/i,
  /\bi(?:'ve| have)\s+(?:set\s+(?:up\s+)?(?:a|an|the)\s+(?:watch|alert|monitor|tracker|reminder)|started\s+(?:watching|monitoring|tracking))\b/i,
  // 11 Oct live run: a bare "Option 1" reached chat, which answered "I've opened the Playo page
  // for Smaaash..." with nothing opened. Chat cannot open, browse or check a live page.
  /\b(?:i(?:'ve| have)|i)\s+(?:just\s+)?(?:opened|loaded|visited|browsed|navigated\s+to|pulled\s+up)\s+(?:the\s+|their\s+|its\s+|your\s+)?[\w .'&-]{0,40}\b(?:page|site|website|link|listing|app)\b/i,
  /\bi(?:'ve| have)\s+(?:checked|looked\s+at|seen)\s+(?:the\s+)?(?:live\s+)?(?:slots?|availability)\b/i,
]

export const NO_ACTION_REPLY =
  "Nothing has been started. Gogo only runs a task after it sends you a real approval request for it, and there isn't one waiting. Send the request again in one message (for example: create a Hugging Face account for you@example.com) and I'll set it up."

// 14 Oct live run (dashboard): "Skip lunch today, I'm fasting" reached plain chat, which replied
// "Skipped today's lunch reminder (2:30 pm). It'll fire again tomorrow as usual" — there was no
// lunch reminder and nothing ran. The phrase list above can never be complete, so this reads the
// SHAPE of each sentence instead: a sentence that opens by reporting a finished change to the
// user's own reminders, lists, events or times ("Skipped …", "I've cancelled …", "Added … to your
// list", "Set for 6am") is a receipt. Receipts come only from handlers that did the work; plain
// chat has no executor, so one from chat is false whatever the wording.
const CHANGE_VERB =
  '(?:skipped|cancell?ed|deleted|removed|added|created|scheduled|rescheduled|snoozed|updated|moved|marked|saved|stopped|paused|cleared|renamed|booked|sent|rejected|approved|declined|withdrawn|set(?=\\s+(?:for|to|it|up)\\b))'
const RECEIPT_LEAD = new RegExp(
  '^[\\s\\W_]*(?:(?:done|ok(?:ay)?|got\\s+it|sure|all\\s+set|alright)[\\s,.!:\\u2013-]*)?' +
    "(?:(?:i(?:'ve|\\s+have)?|gogo(?:\\s+has)?)\\s+(?:just\\s+)?|just\\s+)?" +
    CHANGE_VERB +
    '\\b(.{0,90})',
  'i',
)
const USER_ITEM =
  /\b(?:reminders?|lists?|events?|alarms?|meetings?|tasks?|notes?|calendar|schedule|appointments?|watch(?:es)?|alerts?|drafts?|expenses?|occurrences?|approvals?|requests?|bookings?|orders?|runs?)\b|\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:today|tomorrow)(?:'s|\u2019s)\b/i

// 19 Oct live (WhatsApp): "abort mission" reached chat, which answered "Both Jailer 2 calendar
// approvals are cancelled" while both stayed pending. A passive receipt about items only Gogo
// itself manages (approvals, reminders, its tasks, watches, lists, drafts) is the same false claim
// as an active one. Third-party objects (orders, bookings, meetings, requests, payments) are
// reported from email/calendar data all the time, so they are not receipts here.
const GOGO_ITEM = /\b(?:approvals?|reminders?|alarms?|tasks?|watch(?:es)?|alerts?|lists?|notes?|drafts?|to-?dos?|calendar\s+blocks?)\b/i
const PASSIVE_RECEIPT = new RegExp(
  "\\b(?:is|are|was|were|got|now|(?:has|have)\\s+(?:now\\s+)?been)\\s+(?:now\\s+|all\\s+|both\\s+|successfully\\s+)?" + CHANGE_VERB + '\\b',
  'i',
)
// "Done. Both approvals cancelled." — a verbless receipt.
const VERBLESS_RECEIPT = new RegExp('\\b(?:both|all|the|your)\\s+(?:\\w+\\s+){0,3}?(?:approvals?|reminders?|tasks?|watch(?:es)?|alerts?)\\s+' + CHANGE_VERB + '\\s*[.!]?\\s*$', 'i')
const NOT_A_RECEIPT = /\?\s*$|\b(?:can|could|should|would|will|may|might|if|once|until|unless|not|never)\b|\bby\s+\S+|\baccording\s+to\b|\b(?:says|said|shows|showed|reports|lists|per)\b|\b(?:yesterday|earlier|ago|last\s+(?:night|week|month|year)|previously|before)\b|\b(?:e-?mails?|inbox|mail)\b/i

export function claimsCompletedChange(reply: string): boolean {
  return String(reply || '')
    .split(/\n+|(?<=[.!?])\s+/)
    .some((sentence) => {
      const m = RECEIPT_LEAD.exec(sentence)
      if (m && USER_ITEM.test(m[1] || '')) return true
      if (NOT_A_RECEIPT.test(sentence) || !GOGO_ITEM.test(sentence)) return false
      return PASSIVE_RECEIPT.test(sentence) || VERBLESS_RECEIPT.test(sentence)
    })
}

export const NO_CHANGE_REPLY =
  "I haven't changed anything. That reply came from a normal chat answer, and chat can't skip, cancel, add or set things. If you want something done, say it directly, for example: skip my water reminder today."

export function claimsUnperformedAction(reply: string): boolean {
  const text = String(reply || '')
  return FAKE_ACTION_CLAIMS.some((re) => re.test(text))
}

/** Replace a chat reply that claims an action Gogo did not take. */
export function guardChatActionClaims(reply: string): { text: string; blocked: boolean } {
  if (claimsUnperformedAction(reply)) return { text: NO_ACTION_REPLY, blocked: true }
  if (claimsCompletedChange(reply)) return { text: NO_CHANGE_REPLY, blocked: true }
  return { text: reply, blocked: false }
}
