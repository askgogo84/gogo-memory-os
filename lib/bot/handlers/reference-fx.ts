import {searchReferenceFx} from '@/lib/services/reference-fx'

/** Keep strict reference queries intact before a planner can rewrite them. */
export async function buildReferenceFxReply(text:string):Promise<string|null>{
  const quotes=await searchReferenceFx(text)
  if(quotes===null)return null
  if(!quotes.length)return "I couldn't verify a dated currency reference estimate just now. No exchange or payment was made."
  return `${quotes[0].snippet}\nSource: ${quotes[0].url}`
}
