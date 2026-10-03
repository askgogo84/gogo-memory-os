import { buildReminderConfirmation, getAmbiguousReminderTime, parseReminderIntent, reminderTimingProblem } from './reminders'

function choiceParts(text:string){
  const raw=String(text||'').toLowerCase().trim().replace(/a\.m\.?/g,'am').replace(/p\.m\.?/g,'pm')
  const word=raw.match(/^(morning|evening|night|am|pm)$/)
  if(word)return{hour:null as number|null,minute:null as number|null,suffix:(word[1]==='morning'||word[1]==='am'?'am':'pm') as 'am'|'pm'}
  const clock=raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/)
  if(!clock)return null
  const hour=Number(clock[1]),minute=Number(clock[2]||0)
  if(hour<1||hour>12||minute<0||minute>59)return null
  return{hour,minute,suffix:clock[3] as 'am'|'pm'}
}

export function isAmPmChoice(text: string) {
  return Boolean(choiceParts(text))
}

function resolvedAmPmText(originalText: string, choiceText: string) {
  const ambiguous = getAmbiguousReminderTime(originalText)
  if (!ambiguous) return null
  const choice=choiceParts(choiceText)
  if(!choice)return null

  // "8 pm" is a natural answer to "8 AM or PM?". If the user writes a clock
  // value, require it to match the hour/minute we asked about rather than silently
  // applying a different value to the original ambiguous time.
  if(choice.hour!==null&&(choice.hour!==ambiguous.hour||choice.minute!==ambiguous.minute))return null

  const fullTime = `${ambiguous.label} ${choice.suffix}`
  // Replace the clock we asked about, never a year elsewhere in the request.
  return originalText.replace(/\bat\s+\d{1,2}(?::\d{2})?\b/i, `at ${fullTime}`)
}

export function amPmReminderTimingProblem(originalText: string, choiceText: string) {
  const resolved = resolvedAmPmText(originalText, choiceText)
  return resolved ? reminderTimingProblem(resolved) : null
}

export function buildReminderFromAmPmChoice(originalText: string, choiceText: string) {
  const resolved = resolvedAmPmText(originalText, choiceText)
  return resolved ? parseReminderIntent(resolved) : null
}

export function buildAmPmReminderSetReply(parsed: NonNullable<ReturnType<typeof parseReminderIntent>>) {
  return buildReminderConfirmation(parsed)
}
