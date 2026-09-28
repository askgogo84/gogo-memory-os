import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

/** Only user-authored context expands an anaphoric follow-up, never assistant guesses. */
export function recallQuery(text:string,history:Array<{role:string;content:string}>):string {
  if(text.length>200||! /\b(she|he|her|his|it|that|same|already|look[ -]?up|look again|you have)\b/i.test(text))return text
  const previous=[...history].reverse().find(turn=>turn.role==='user'&&turn.content.trim()!==text.trim()&&!turn.content.startsWith('['))
  return previous?`${text}\nPrevious user request: ${redactSecretShapedText(previous.content).slice(0,1000)}`:text
}
