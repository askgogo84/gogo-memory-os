import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

const noise=new Set('review list show find retrieve read check inspect look up reminders reminder active upcoming pending saved existing entries entry my me the a an for about related to this that these those trip travel flight flights checklist only please all account wide on at in of and with from plan organize organisation organization confirm status departure arrival time dates date tomorrow today next week am pm sep september jan january feb february mar march apr april may jun june jul july aug august oct october nov november dec december'.split(' '))
function terms(text:string){return text.toLowerCase().replace(/newyork/g,'new york').replace(/\b(?:do not|don.t|never)\b[^.;!?]*/gi,'').match(/[a-z][a-z0-9]*/g)?.filter(word=>word.length>2&&!noise.has(word))||[]}

/** Conservative text matching: uncertain references never turn into account-wide lists. */
export function reminderScope(step:{title:string;instruction:string},mission:string){
  const stepText=`${step.title} ${step.instruction}`
  const scoped=/\b(for|about|related to|trip|checklist|flight|this|that)\b/i.test(stepText)
  const stepTerms=terms(stepText)
  const scopeTerms=stepTerms.length?stepTerms:scoped?terms(mission):[]
  return {scopeTerms:[...new Set(scopeTerms)],unresolved:scoped&&!scopeTerms.length}
}

export async function readScopedReminders(ownerId:number,step:{title:string;instruction:string},mission:string){
  const scope=reminderScope(step,mission)
  const reminders:Array<{id:string;message:string;remindAt:string;timezone:string}>=[]
  const now=new Date().toISOString()
  let truncated=false
  for(let offset=0;offset<1000;offset+=100){
    const {data,error}=await supabaseAdmin.from('reminders').select('id,message,remind_at,timezone')
      .eq('telegram_id',ownerId).eq('sent',false).gte('remind_at',now)
      .order('remind_at',{ascending:true}).order('id',{ascending:true}).range(offset,offset+99)
    if(error)throw new Error(`mission_reminder_read_failed:${error.message}`)
    if(data?.length&&scope.unresolved)throw new Error('mission_reminder_scope_unverified')
    for(const row of data||[]){
      const message=redactSecretShapedText(String(row.message||''))
      const words=message.toLowerCase().replace(/newyork/g,'new york').match(/[a-z][a-z0-9]*/g)||[]
      if(!scope.scopeTerms.every(term=>words.some(word=>word===term||(term.length>=4&&word.startsWith(term)))))continue
      reminders.push({id:String(row.id),message:message.slice(0,500),remindAt:String(row.remind_at),timezone:String(row.timezone||'UTC')})
    }
    if((data||[]).length<100)break
    if(offset===900)truncated=true
  }
  return {reminders,truncated,scopeTerms:scope.scopeTerms}
}
