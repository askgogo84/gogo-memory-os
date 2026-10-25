// Pure, dependency-free reading of a guest-name reply ("Divya Rao", "book under Divya"). Shared by the
// live-slot name step in restaurant-reservation and the pending-question resolver's cheap classifier.
const NOT_NAME_WORDS=new Set(['yes','yeah','yep','no','nope','ok','okay','sure','approve','approved','reject','cancel','stop','thanks','thank','thx','hi','hello','hey','help','done','later','wait','what','why','how','when','where','confirm','go','ahead','please','book','booking','table','tomorrow','today','tonight','gogo','the','a','an','for','at','is','it','me','my','you','not','fine','good','great','cool','nice','instead','time','slot','pm','am','reserve','reservation','change','other','another','none','nothing'])
/** A reply that is only a guest name ("Divya Rao", "book under Divya"). Commands and chatter are not names. */
export function guestNameFromReply(raw:string){
  let t=String(raw||'').trim().replace(/[.!]+$/,'').replace(/\s+/g,' ')
  t=t.replace(/^(?:please\s+)?(?:(?:book|reserve|put)\s+(?:it\s+|the\s+table\s+)?under|under|(?:my\s+|the\s+)?name\s+(?:is|:)|name\s*[:\-]|it'?s|use)\s+/i,'').trim()
  if(t.length<2||t.length>60)return null
  if(!/^\p{L}[\p{L}'’.\-]*(?:\s\p{L}[\p{L}'’.\-]*){0,4}$/u.test(t))return null
  if(t.toLowerCase().split(' ').some(w=>NOT_NAME_WORDS.has(w.replace(/[.'’]/g,''))))return null
  return t===t.toLowerCase()?t.replace(/(^|\s)\p{L}/gu,s=>s.toUpperCase()):t
}
