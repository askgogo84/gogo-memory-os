// 20 Nov live: "Connect my mail" reached the brain, which told the owner to type the exact command "connect gmail".
// A whole-message ask to connect or reconnect mail, however it is worded, belongs to the connect handler.
// "Set up my inbox" is left out on purpose: it can mean "watch my inbox".
// Anchored at both ends so a longer sentence that merely contains the words ("add 'link my mail to the CRM' to my list") is left alone. Pure.
const LEAD = String.raw`(?:(?:(?:hey|hi|ok(?:ay)?|yes)\s+)?(?:gogo\s*)?[,!]?\s*)?(?:please\s+|pls\s+|plz\s+|kindly\s+|can\s+(?:you|u)\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like)\s+to\s+|need\s+to\s+|help\s+me\s+(?:to\s+)?|let'?s\s+)?`
const WHICH = String.raw`(?:(?:work|office|personal|other|second|tipplr|google)\s+)?`
const NOUN = String.raw`(?:e-?mails?|mails?|g-?mail|mail\s*box|inbox)(?:\s+(?:id|account))?`
export const CONNECT_MAIL_RE = new RegExp(String.raw`^\s*${LEAD}(?:re[- ]?connect|connect|link|hook\s+up)\s+(?:to\s+)?(?:my\s+|the\s+|our\s+)?${WHICH}${NOUN}(?:,?\s+(?:again|please|pls|plz|now))*\s*[.!?]*$`, 'i')
/** "reconnect goverdhan@tipplr.in": refresh one named account. The address is group 1. */
export const RECONNECT_ADDRESS_RE = new RegExp(String.raw`^\s*${LEAD}re[- ]?connect\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})(?:,?\s+(?:again|please|pls|plz|now))*\s*[.!?]*$`, 'i')
/** "connect another mail", "add my work mail": a second account. */
export const ADD_MAIL_RE = new RegExp(String.raw`^\s*${LEAD}(?:re[- ]?connect|connect|add|link)\s+(?:another|a\s+second|one\s+more|my\s+(?:other|work|office|second|tipplr))\s+${NOUN}(?:,?\s+(?:again|please|pls|plz|now))*\s*[.!?]*$`, 'i')
/** A whole message asking to connect, reconnect or add a mail account. Longer messages are never one. Pure. */
export const isConnectMailAsk = (text: unknown) => { const t = String(text || ''); return t.length <= 160 && (CONNECT_MAIL_RE.test(t) || RECONNECT_ADDRESS_RE.test(t) || ADD_MAIL_RE.test(t)) }
