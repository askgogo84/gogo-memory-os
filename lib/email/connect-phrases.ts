// 20 Nov live: "Connect my mail" reached the brain, which told the owner to type the exact command "connect gmail".
// A whole-message ask to connect or reconnect mail, however it is worded, belongs to the connect handler.
// Anchored at both ends so a longer sentence that merely contains the words ("add 'link my mail to the CRM' to my list") is left alone. Pure.
const LEAD = String.raw`(?:(?:hey|hi|ok(?:ay)?)\s+(?:gogo\s*)?[,!]?\s*)?(?:please\s+|pls\s+|can\s+you\s+(?:please\s+)?|could\s+you\s+(?:please\s+)?|i\s+(?:want|need|would\s+like)\s+to\s+|help\s+me\s+(?:to\s+)?|let'?s\s+)?`
const WHICH = String.raw`(?:(?:work|office|personal|other|second|tipplr|google)\s+)?`
const NOUN = String.raw`(?:e-?mails?|mails?|g-?mail|mail\s*box|inbox)(?:\s+(?:id|account))?`
export const CONNECT_MAIL_RE = new RegExp(String.raw`^\s*${LEAD}(?:re-?connect|connect|link|hook\s+up|set\s*up)\s+(?:to\s+)?(?:my\s+|the\s+|our\s+)?${WHICH}${NOUN}(?:\s+(?:again|please|pls|now))*\s*[.!?]*$`, 'i')
/** "reconnect goverdhan@tipplr.in": refresh one named account. The address is group 1. */
export const RECONNECT_ADDRESS_RE = new RegExp(String.raw`^\s*${LEAD}re-?connect\s+([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\s*[.!]*$`, 'i')
export const isConnectMailAsk = (text: unknown) => { const t = String(text || '').slice(0, 160); return CONNECT_MAIL_RE.test(t) || RECONNECT_ADDRESS_RE.test(t) }
