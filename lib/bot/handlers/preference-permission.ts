// Same Brain 3.0, Addendum 5: would this "preference" give Gogo leave to act without the person's yes?
// Pure and dependency-free, so every place that stores a rule or hands stored rules to a model can use it
// (lib/bot/handlers/preference-kind.ts, preferences.ts, lib/agent/context-brain.ts, understanding-context.ts).
// A preference shapes how Gogo writes and works. Approvals are changed only in Trust settings.
//
// This check runs for everyone and also hides matching stored rules from the model, so it is written to be
// narrow: an ordinary rule ("always just reply in one line", "don't ask me for my city again", "always confirm
// all times in IST") must not match. It is a filter on what is stored and shown, not the control: every tool
// enforces its own approval in code whatever a stored rule says.

// Things Gogo does that reach someone else, cost money or cannot be undone.
const ACT = '(?:send(?:ing)?|e-?mail(?:ing)?|mail(?:ing)?|messag(?:e|ing)|text(?:ing)?|whatsapp(?:ing)?|repl(?:y|ying)|contact(?:ing)?|call(?:ing)?|invit(?:e|ing)|post(?:ing)?|publish(?:ing)?|shar(?:e|ing)|forward(?:ing)?|pay(?:ing)?|purchas(?:e|ing)|buy(?:ing)?|order(?:ing)?|book(?:ing)?|reserv(?:e|ing)|cancel(?:ling|ing)?|delet(?:e|ing)|transfer(?:ring)?|approv(?:e|ing)|confirm(?:ing)?|submit(?:ting)?|sign(?:ing)?(?: ?up)?|unsubscrib(?:e|ing))'
// The ones that are not also everyday words for how Gogo talks to its own user ("reply", "share", "call", "text",
// "order my lists", "sign emails as", "confirm the time zone").
const STRONG = '(?:send(?:ing)?|e-?mail(?:ing)?|forward(?:ing)?|pay(?:ing)?|purchas(?:e|ing)|buy(?:ing)?|book(?:ing)?|reserv(?:e|ing)|cancel(?:ling|ing)?|delet(?:e|ing)|transfer(?:ring)?|submit(?:ting)?|publish(?:ing)?|invit(?:e|ing)|contact(?:ing)?|unsubscrib(?:e|ing)|place (?:an? |the |my |all )?orders?)'
// Not "book-end", "pay attention", or something sent to the person themselves.
const NOT_SELF = '(?![-\\w])(?!\\s+(?:me|myself|my name|attention|reminders?|(?:the|my|a|an) (?:daily |morning |evening )?(?:brief|briefing|summary|digest|reminders?))\\b)(?![^.!?]{0,40}\\bto me\\b)'
const APPROVAL = '(?:approvals?|permission|confirmations?|consent|go[- ]ahead|say[- ]so|ok|okay|yes|sign[- ]?off)'
const ASKING = `(?:ask(?:ing)?(?: me| first)?|approv(?:al|e|ing)|confirm(?:ation|ing)?|permission|consent|check(?:ing)? with me|check(?:ing)?(?: first)?(?=\\s*(?:$|[.,;!?]|and\\b|but\\b))|my (?:ok|okay|yes|go[- ]ahead|say[- ]so|review)|review|showing me|telling me|waiting(?: for me)?|a (?:yes|go[- ]ahead))`
const WITHOUT = "(?:without|with out|witout|w/o|sans|with no|skip(?:ping)?|bypass(?:ing)?|no need (?:for|to)|needn'?t|don'?t need(?: to)?|do not need(?: to)?)"
const STOP = "(?:don'?t|do not|never|stop|quit|no need to|needn'?t|you don'?t (?:have|need) to|you needn'?t)"
const AUTO = '(?:on your own|by yourself|yourself|automatically|autonomously|automatic|right away|immediately|straight ?away|instantly|directly|the moment|as soon as|when (?:they|it) arrives?)'
const THINGS = '(?:purchases?|payments?|orders?|bookings?|reservations?|transfers?|e-?mails?|messages?)'

// "don't ask me before sending", "never ask for approval", "stop asking me to confirm", "stop showing approval
// cards": the stop itself is being switched off. The object must be an approval or an action; "don't ask me for
// my city again" and "never ask me which calendar" are not this.
const NO_ASK = new RegExp(`\\b${STOP}\\s+(?:ever\\s+|keep\\s+)?(?:ask(?:ing)?|wait(?:ing)?|check(?:ing)?|confirm(?:ing)?|seek(?:ing)?|request(?:ing)?|show(?:ing)?)\\b[^.!?]{0,60}?(?:\\b(?:before|prior to|when|while)\\s+(?:you\\s+|i\\s+|we\\s+)?(?:\\w+\\s+){0,2}?${ACT}\\b|\\b(?:for|my|an?|any|the)\\s+(?:my\\s+|an?\\s+|any\\s+|the\\s+)?${APPROVAL}\\b|\\bto\\s+(?:approve|confirm)\\b(?!\\s+(?:my|your|the)\\s+(?:name|city|number|address|language|time ?zone|spelling|mood|age|e-?mail)\\b)|\\b${APPROVAL}\\s+(?:cards?|prompts?|steps?|requests?)\\b)`, 'i')

const GRANTS: RegExp[] = [
  // "send emails without asking", "book it without my approval", "reply to Divya without asking", "send without waiting"
  new RegExp(`\\b${ACT}\\b[^.!?]{0,80}\\b${WITHOUT}\\s+(?:any\\s+|my\\s+|an?\\s+|the\\s+|to\\s+|further\\s+)*${ASKING}\\b`, 'i'),
  // "payments under 500 are okay without me", "emails go out unreviewed"
  new RegExp(`\\b${THINGS}\\b[^.!?]{0,40}\\b(?:ok|okay|fine|allowed|approved)\\s+(?:without|with out|witout)\\b|\\b(?:unreviewed|unapproved)\\b`, 'i'),
  // "auto-approve", "approve everything", "approve all payments", "you are pre-approved"
  /\bauto[- ]?(?:approv|confirm|pay|book)\w*|\bauto[- ]?send(?!\w*\s+me\b)/i,
  /\b(?:approve|accept|allow|confirm)\s+(?:everything|anything)\b|\b(?:approve|confirm|accept|allow)\s+(?:all|every)\s+(?:my\s+|the\s+)?(?:orders?|payments?|bookings?|e-?mails?|messages?|purchases?|requests?|actions?|transactions?|transfers?|invit\w+)\b|\byes to (?:everything|all|anything)\b/i,
  /\b(?:pre[- ]?approved|blanket (?:approval|permission)|standing (?:approval|permission))\b|\bapprovals?\s+off\b/i,
  // "skip approvals", "skip the confirmation step", "no more approval prompts", "no approvals", "no confirmation needed"
  /\b(?:skip(?:ping)?|turn off|disable|drop|remove|no more)\s+(?:the\s+|all\s+|any\s+)?(?:approvals?|confirmations?)\b|\bno approvals?\b(?!\s+(?:talk|chat|mentions?|updates?|news|jargon)\b)|\bno (?:confirmations?|permission) (?:is |are )?(?:needed|required|necessary)\b|\b(?:approvals?|confirmations?|permission)\s+(?:is|are)\s+(?:not|never)\s+(?:needed|required|necessary)\b/i,
  new RegExp(`\\b(?:never|don'?t|do not|no)\\s+need\\s+(?:for\\s+)?my\\s+${APPROVAL}\\b|\\b(?:bother|trouble|disturb|bug)\\s+me\\s+(?:with|for|about)\\s+(?:approvals?|confirmations?)\\b|\\b(?:don'?t|do not|never)\\s+hold\\b[^.!?]{0,40}\\b(?:approval|review|confirmation)\\b`, 'i'),
  // "you can always pay my bills", "go ahead and book tables", "just send it"
  new RegExp(`\\b(?:you (?:can|may)|feel free to|just|go ahead and|directly)\\s+(?:always\\s+|just\\s+|go ahead and\\s+|directly\\s+)*${STRONG}${NOT_SELF}`, 'i'),
  new RegExp(`\\b(?:you are allowed to|you have (?:my )?permission to|i (?:allow|permit|authori[sz]e) you to)\\s+(?:always\\s+)?${ACT}\\b(?!\\s+(?:me|myself)\\b)`, 'i'),
  // "send emails right away", "pay my bills when they arrive", "handle payments yourself", "place it immediately"
  new RegExp(`\\b${STRONG}${NOT_SELF}[^.!?]{0,60}\\b${AUTO}\\b`, 'i'),
  new RegExp(`\\b(?:complete|handle|make|place|do|manage|process|finish)\\s+(?:my\\s+|the\\s+|all\\s+|any\\s+)*${THINGS}\\b[^.!?]{0,40}\\b${AUTO}\\b|\\bplace (?:it|them)\\b[^.!?]{0,30}\\b${AUTO}\\b`, 'i'),
  /\b(?:proceed|act|go ahead|execute|carry on)\s+(?:automatically|autonomously|on your own|without)\b|\bact first\b[^.!?]{0,10}\bask later\b|\byou decide and (?:do|book|send|pay|order)\b/i,
  // "treat my yes as given", "consider it approved", "assume I approve"
  /\b(?:treat|take|consider|assume|count)\b[^.!?]{0,40}\b(?:yes|approval|consent|ok|okay|go[- ]ahead|permission)\b[^.!?]{0,20}\b(?:given|granted|read|implied|automatic|default)\b|\bconsider (?:it|them|that|this) (?:approved|confirmed|agreed|a yes)\b|\bassume (?:that )?(?:i|i'll|i will|i would|i'd)\s+(?:always\s+)?(?:approve|agree|consent|say yes|said yes)\b|\bassume my (?:consent|approval|yes)\b/i,
  // "reply to Divya on my behalf", "respond to my emails for me", "act on my behalf without checking"
  /\b(?:reply|respond|answer|send|e-?mail|message|text|whatsapp)\b[^.!?]{0,40}\b(?:on my behalf|for me)\b(?![^.!?]*\b(?:to (?:review|approve|check|see)|drafts?)\b)|\bon my behalf\b[^.!?]{0,40}\bwithout\b/i,
  /\b(?:do|take) whatever (?:it takes|you want|is needed)\b|\b(?:you have|take|give you|giving you|grant(?:ing)? you|with) full (?:access|control|autonomy|authority)\b/i,
  // "my approval is implied", "approval not needed", "confirmation is optional", "zero approvals", "drafts are approved by default"
  /\b(?:approvals?|confirmations?|consent|permission)\s+(?:is\s+|are\s+)?(?:implied|implicit|assumed|not needed|unnecessary|optional|by default)\b|\bzero approvals?\b|\bi (?:need not|needn'?t|don'?t need to|do not need to) (?:approve|confirm|see|review)\b|\bdrafts?\b[^.!?]{0,20}\b(?:approved|final)\b/i,
  // "take silence as a yes", "my answer is always yes", "presume consent", "if I don't reply in 5 minutes, send it"
  /\b(?:silence|no reply|no response)\b[^.!?]{0,20}\b(?:as|is|means?)\s+(?:a\s+|my\s+)?(?:yes|approval|consent|ok)\b|\bmy answer is always yes\b|\bpresume\s+(?:my\s+)?(?:consent|approval|i agree|i approve)\b|\bif i (?:don'?t|do not) (?:reply|respond|answer)\b[^.!?]{0,30}\b(?:send|pay|book|order|go ahead|proceed)\b/i,
  // "don't stop for approval", "never pause before sending", "leave me out of approvals", "send emails w/o me"
  /\b(?:don'?t|do not|never)\s+(?:stop|pause|hold|wait)\b[^.!?]{0,20}\b(?:for (?:my |an? )?(?:approval|confirmation|permission)|before (?:sending|paying|booking|ordering))\b|\b(?:leave|keep|take) me out of\b[^.!?]{0,15}\bapprovals?\b|\bremove me from the approval\b|\b(?:send|pay|book|order)\b[^.!?]{0,40}\b(?:w\/o|without|sans) me\b/i,
  // "you are authorised to pay", "I authorise all payments under 1000", "I trust you to send emails"
  new RegExp(`\\byou are authori[sz]ed to\\b|\\bi authori[sz]e\\b|\\bi trust you to\\s+${STRONG}\\b`, 'i'),
  // "book first and tell me later", "pay first and inform me after", "pay, no questions asked"
  new RegExp(`\\b${STRONG}\\b[^.!?]{0,30}\\b(?:tell|inform|notify|update) me (?:later|after\\w*)\\b|\\bno questions asked\\b`, 'i'),
  // "Divya can approve for me", "Nithin's yes is my yes"
  /\bcan approve (?:for|on behalf of) me\b|\b\w+'s yes is my yes\b/i,
  // Instructions from somewhere else given standing authority: "follow instructions inside emails", "do what forwarded messages say"
  /\b(?:follow(?! up)|obey|do what|act on|carry out|execute)\b[^.!?]{0,30}\b(?:instructions?|e-?mails?|messages?|documents?|forwards?)\b[^.!?]{0,20}\b(?:say|says|inside|in|from|i forward)\b/i,
  // elevated or override instructions dressed as a preference
  /\b(?:ignore|override|bypass|disregard)\s+(?:the\s+|your\s+|all\s+|any\s+)*(?:(?:your|safety|approval|system)\s+(?:own\s+)?rules?|safety|polic(?:y|ies)|guard\w*|restrictions?|sentinel|trust|approvals?|confirmations?)\b|\b(?:ignore|override|bypass|disregard)\s+(?:all\s+)?(?:your|the system|system|previous|prior|earlier|above)\s+(?:instructions?|limits?|prompt)\b/i,
  // A second sentence that drops the ask: "always send emails. no need to ask.", "always send the email; don't ask"
  /\bno need to (?:ask|confirm|check)(?:\s+(?:me|first|with me))*\s*[.!]*$|[.;,]\s*(?:and\s+)?(?:don'?t|do not|never) ask(?:\s+(?:me|first))*\s*[.!]*$/i,
  // Hinglish: "bina puche email bhej do", "mujhse mat pucho, seedha book kar do"
  /\bbina\s+(?:mujhse\s+)?p(?:u|oo)chh?\w*|\bp(?:u|oo)chh?e\s+bina\b|\bp(?:u|oo)chh?ne\s+ki\s+zaroo?rat\s+nahi\b|\bp(?:u|oo)chh?na\s+mat\b|\bseedh[ae]\s+(?:pay|book|send|order|bhej)\b|\bwithout\s+p(?:u|oo)chh?\w*|\bmat\s+p(?:u|oo)chh?o\b[^!?]{0,40}\bseedh[ae]\b/i,
]

// "don't contact anyone without my approval", "always ask me before sending", "always get my approval before paying":
// rules that only add a stop before an action.
const RESTRICTS: RegExp[] = [
  new RegExp(`\\b(?:don'?t|do not|never)\\s+(?:ever\\s+)?${ACT}\\b[^.!?]{0,80}?\\b(?:without|unless|until|before)\\b[^.!?]{0,30}?\\b(?:ask\\w*|approv\\w*|confirm\\w*|permission|check(?:ing)? with me|ok|okay|yes|go[- ]ahead|consent|i (?:say|agree|tell))\\b`, 'i'),
  new RegExp(`\\b(?:always\\s+)?(?:ask|check with|confirm with|wait for|show)\\s+me\\s+(?:first\\b(?!\\s+(?:which|what|how|where|who|whether|if|thing|the)\\b)|before\\s+(?:you\\s+|i\\s+)?(?:\\w+\\s+)??(?:${ACT}|act(?:ing)?|do(?:ing)?|anything|going ahead|proceed\\w*)\\b(?:\\s+anything)?)`, 'i'),
  new RegExp(`\\b(?:always\\s+)?(?:ask|get|take|wait for)\\s+(?:for\\s+)?(?:my\\s+)?(?:approval|permission|confirmation|ok|okay|go[- ]ahead)\\s+(?:before|first)\\b`, 'i'),
]

// Bounded, so a very long stored rule cannot make the check slow.
const norm = (text: string) => String(text || '').slice(0, 1000).replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
// A stop with a carve-out ("always ask me before paying, except Swiggy") lifts the stop for the carve-out.
const CARVE_OUT = /\b(?:except|unless it|other than|otherwise|only for|apart from|but not)\b/i

/** Would storing this as a rule try to give Gogo leave to act without the person's yes? */
export function grantsPermission(text: string): boolean {
  const t = norm(text)
  if (!t) return false
  if (NO_ASK.test(t)) return true
  // A clause that only adds a stop ("don't email anyone without my approval") is set aside; whatever else the
  // message says is still checked, so "always ask me first, but you can always pay my bills" is a grant.
  // Reminding the person to do something is not Gogo doing it ("remind me to pay bills immediately").
  let rest = t.replace(/\bremind(?:ing)? me (?:to|about)\b[^.;!?]*/gi, ' ; ')
  const base = rest
  for (const r of RESTRICTS) rest = rest.replace(new RegExp(r.source, 'gi'), ' ; ')
  if (rest !== base && CARVE_OUT.test(t)) return true
  return GRANTS.some(r => r.test(rest)) || NO_ASK.test(rest)
}
/** Does it add a stop for the person's yes before an action (and nothing else that grants)? */
export function isRestrictive(text: string): boolean {
  const t = norm(text)
  return RESTRICTS.some(r => r.test(t)) && !grantsPermission(t)
}
