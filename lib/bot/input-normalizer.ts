// Lightweight, deterministic input repair before AskGogo intent routing.
//
// Scope is intentionally narrow: repair command/action vocabulary and obvious
// accidental prefix noise. Never spell-correct arbitrary names, places, products,
// note content, URLs, IDs, or free-form prose.

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

const INTENT_WORD_TYPOS: Record<string,string> = {
  remider:'reminder', remnder:'reminder', remaider:'reminder', reminer:'reminder',
  calender:'calendar', calandar:'calendar', calandar:'calendar',
  cheklist:'checklist', checkist:'checklist', checlist:'checklist',
  grocerry:'grocery', groccery:'grocery', grocerries:'groceries',
  appoinment:'appointment', appointement:'appointment',
  schedual:'schedule',
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

function repairIntentWords(line:string){
  return line.replace(/\b[A-Za-z]+\b/g,(word)=>{
    const replacement=INTENT_WORD_TYPOS[word.toLowerCase()]
    return replacement ? preserveCase(replacement,word) : word
  })
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
  lines[0]=first

  const repaired=lines.map((line)=>repairIntentWords(line))
  if(repaired.some((line,i)=>line!==lines[i]))reasons.push('intent_spelling')
  text=repaired.join('\n').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n').trim()

  return{text,changed:text!==original.trim(),reasons:[...new Set(reasons)]}
}
