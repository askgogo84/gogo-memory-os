// Lightweight, deterministic input repair before AskGogo intent routing.
//
// Scope is intentionally narrow: repair command/action vocabulary and obvious
// accidental prefix noise. Never spell-correct arbitrary names, places, products,
// note content, URLs, IDs, checklist items, or free-form prose.

const COMMAND_WORDS = [
  'save','remind','remember','show','add','create','schedule','book','set','put',
  'delete','cancel','remove','clear','list','check','uncheck','mark','connect','plan',
  'log','track','find','search','open','view','send','draft','pay','translate','help',
  'dashboard','snooze','move','change','update','share','keep',
] as const

const FIRST_WORD_TYPOS: Record<string,string> = {
  svae:'save', sae:'save', sav:'save', savee:'save',
  remid:'remind', remimd:'remind', remaind:'remind', remnd:'remind', remin:'remind',
  remeber:'remember', rember:'remember', remmeber:'remember',
  shwo:'show', sho:'show',
  adn:'add', ad:'add',
  craete:'create', creat:'create',
  schdule:'schedule', scedule:'schedule', scheduel:'schedule',
  bok:'book', boook:'book',
  canel:'cancel', cnacel:'cancel', cancell:'cancel',
  delte:'delete', delet:'delete',
  serach:'search', seach:'search', srch:'search',
  opne:'open',
  viwe:'view',
  sned:'send',
  drfat:'draft',
  translte:'translate',
  chek:'check',
  unchek:'uncheck',
  updte:'update',
}

const commandAlternation = COMMAND_WORDS.join('|')
const accidentalPrefix = new RegExp(`^[^A-Za-z]{1,4}(?=(${commandAlternation})\\b)`, 'i')

function preserveCase(replacement:string, original:string){
  if(original.toUpperCase()===original)return replacement.toUpperCase()
  if(original[0]===original[0]?.toUpperCase())return replacement[0].toUpperCase()+replacement.slice(1)
  return replacement
}

function repairFirstWord(line:string){
  const m=line.match(/^([A-Za-z]+)(\b[\s\S]*)$/)
  if(!m)return line
  const replacement=FIRST_WORD_TYPOS[m[1].toLowerCase()]
  return replacement ? preserveCase(replacement,m[1])+m[2] : line
}

// Intent-word repair is deliberately phrase-scoped. These are routing grammar
// positions, not arbitrary payload positions. For example, "Add Calandar to my
// baby names" must remain byte-for-byte user content; "connect calender" may be
// repaired because the second token is part of the command grammar.
function repairIntentPhrases(line:string){
  let out=line
  out=out.replace(/\b(as\s+(?:a\s+)?)rem(?:ider|nder|aider|iner)\b/gi,(whole,prefix)=>{
    const typo=whole.slice(String(prefix).length)
    return `${prefix}${preserveCase('reminder',typo)}`
  })
  out=out.replace(/^(\s*(?:connect|open|view)\s+(?:my\s+)?)cal(?:ender|andar)\b/i,(whole,prefix)=>{
    const typo=whole.slice(String(prefix).length)
    return `${prefix}${preserveCase('calendar',typo)}`
  })
  out=out.replace(/^(\s*show\s+(?:me\s+)?(?:my\s+)?)cal(?:ender|andar)\b/i,(whole,prefix)=>{
    const typo=whole.slice(String(prefix).length)
    return `${prefix}${preserveCase('calendar',typo)}`
  })
  out=out.replace(/^(\s*(?:create|show|open|view)\s+(?:(?:a|my)\s+)?)chec?k(?:list|ist)|^(\s*(?:create|show|open|view)\s+(?:(?:a|my)\s+)?)checlist/i,(whole,p1,p2)=>{
    const prefix=String(p1||p2||'')
    const typo=whole.slice(prefix.length)
    return `${prefix}${preserveCase('checklist',typo)}`
  })
  out=out.replace(/^(\s*(?:schedule|book|create)\s+(?:(?:an|my)\s+)?)appoint(?:ment|ement)\b/i,(whole,prefix)=>{
    const typo=whole.slice(String(prefix).length)
    return `${prefix}${preserveCase('appointment',typo)}`
  })
  return out
}

export type NormalizedUserInput={text:string;changed:boolean;reasons:string[]}

export function normalizeUserInputForRouting(value:string):NormalizedUserInput{
  const original=String(value||'')
  let text=original.normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').trim()
  const reasons:string[]=[]
  if(!text)return{text:'',changed:text!==original,reasons}

  const lines=text.split(/\r?\n/)
  let first=lines[0]
  const withoutNoise=first.replace(accidentalPrefix,'')
  if(withoutNoise!==first){first=withoutNoise;reasons.push('leading_noise')}
  const firstFixed=repairFirstWord(first)
  if(firstFixed!==first){first=firstFixed;reasons.push('command_spelling')}
  const intentFixed=repairIntentPhrases(firstFixed)
  if(intentFixed!==firstFixed)reasons.push('intent_spelling')
  lines[0]=intentFixed

  // Preserve the user's remaining lines and internal spacing exactly. The
  // normalized text can be passed to mutating handlers without rewriting payloads.
  text=lines.join('\n').trim()

  return{text,changed:text!==original.trim(),reasons:[...new Set(reasons)]}
}
