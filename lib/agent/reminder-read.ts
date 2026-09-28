import { getLocalParts, isValidTimezone } from '@/lib/timezone'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

export function reminderTimezoneMetadata(text:string){
  let timezone:string|undefined
  const cleaned=text.replace(/\b(?:[a-z][a-z0-9._+-]*(?:\/[a-z0-9._+-]+)+|IST|UTC|GMT)\b/gi,token=>{
    const candidate=token.toUpperCase()==='IST'?'Asia/Kolkata':token
    if(!isValidTimezone(candidate))return token
    timezone??=new Intl.DateTimeFormat('en-US',{timeZone:candidate}).resolvedOptions().timeZone
    return ' '
  })
  return {timezone,text:cleaned}
}

const noise=new Set('review list show find retrieve read check inspect look up reminders reminder active upcoming pending saved existing entries entry scheduled created added set updated my me the a an for about related to this that these those trip travel flight flights checklist only please all account wide on at in of and with from plan organize organisation organization confirm status departure arrival time dates date tomorrow today next week am pm sep sept september jan january feb february mar march apr april may jun june jul july aug august oct october nov november dec december'.split(' '))
function terms(text:string){return reminderTimezoneMetadata(text).text.toLowerCase().replace(/newyork/g,'new york').replace(/\b(?:do not|don.t|never|without)\b[^.;!?]*/gi,'').match(/[a-z][a-z0-9]*/g)?.filter(word=>word.length>2&&!noise.has(word))||[]}

/** Conservative text matching: uncertain references never turn into account-wide lists. */
export function reminderScope(step:{title:string;instruction:string},mission:string){
  const stepText=`${step.title} ${step.instruction}`
  const scoped=/\b(for|about|related to|trip|checklist|flight|this|that)\b/i.test(stepText)
  const groups=(text:string)=>text.split(/\b(?:and|or)\b|[,;→]/i).map(part=>[...new Set(terms(part))]).filter(group=>group.length)
  const stepGroups=groups(stepText)
  const scopeGroups=stepGroups.length?stepGroups:scoped?groups(mission):[]
  const scopeTerms=[...new Set(scopeGroups.flat())]
  return {scopeTerms,scopeGroups,unresolved:scoped&&!scopeTerms.length}
}

export async function readScopedReminders(ownerId:number,step:{title:string;instruction:string},mission:string,temporal?:{timezone:string;dates:string[];clock:string|null;clocks?:string[]}){
  const scope=reminderScope(step,mission)
  const reminders:Array<{id:string;message:string;remindAt:string;timezone:string}>=[]
  const now=new Date().toISOString()
  let truncated=false
  for(let offset=0;offset<1000;offset+=100){
    const {data,error}=await supabaseAdmin.from('reminders').select('id,message,remind_at,timezone')
      .eq('telegram_id',ownerId).eq('sent',false).gte('remind_at',now)
      .order('remind_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+99)
    if(error)throw new Error(`mission_reminder_read_failed:${error.message}`)
    if(data?.length&&scope.unresolved&&!temporal)throw new Error('mission_reminder_scope_unverified')
    for(const row of data||[]){
      if(temporal){
        const local=getLocalParts(new Date(row.remind_at),temporal.timezone)
        const date=`${local.year}-${String(local.month).padStart(2,'0')}-${String(local.day).padStart(2,'0')}`
        const clock=`${String(local.hour).padStart(2,'0')}:${String(local.minute).padStart(2,'0')}`
        if(temporal.dates.length&&!temporal.dates.includes(date))continue
        const clocks=temporal.clocks||(temporal.clock?[temporal.clock]:[])
        if(clocks.length&&!clocks.includes(clock))continue
      }
      const message=redactSecretShapedText(String(row.message||''))
      const words=message.toLowerCase().replace(/newyork/g,'new york').match(/[a-z][a-z0-9]*/g)||[]
      if(scope.scopeGroups.length&&!scope.scopeGroups.some(group=>group.every(term=>words.some(word=>word===term||(term.length>=4&&word.startsWith(term))))))continue
      reminders.push({id:String(row.id),message:message.slice(0,500),remindAt:String(row.remind_at),timezone:String(row.timezone||'UTC')})
    }
    if((data||[]).length<100)break
    if(offset===900)truncated=true
  }
  return {reminders,truncated,scopeTerms:scope.scopeTerms}
}
