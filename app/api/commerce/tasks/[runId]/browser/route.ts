import {NextResponse} from 'next/server'
import {isAgentSession, requireAgentMutationOrigin, requireAgentSession} from '@/lib/agent/session'
import {resolveAgentActor} from '@/lib/agent/actor'
import {acquireBrainUserLease, releaseBrainUserLease} from '@/lib/agent/brain-runtime-guard'
import {readCommerceTask, commerceTaskView} from '@/lib/commerce/task'
import {COMMERCE_BROWSER_PROVIDERS, runCommerceBrowserRead, type CommerceBrowserProvider} from '@/lib/commerce/browser'

export const dynamic='force-dynamic'
export const maxDuration=300
export async function POST(request:Request,context:{params:Promise<{runId:string}>}){
  const blocked=requireAgentMutationOrigin(request)
  if(blocked)return blocked
  const session=await requireAgentSession(request)
  if(!isAgentSession(session))return session
  let input:any
  try{input=await request.json()}catch{return NextResponse.json({error:'invalid_provider'},{status:400})}
  if(!input||typeof input.provider!=='string'||!Object.hasOwn(COMMERCE_BROWSER_PROVIDERS,input.provider))return NextResponse.json({error:'invalid_provider'},{status:400})
  if(input.action!==undefined&&!['read','take_control'].includes(input.action))return NextResponse.json({error:'invalid_action'},{status:400})
  const runId=(await context.params).runId
  const key='commerce-browser:'+session.telegramId
  let lease:{ownerToken:string}|null=null
  try{
    lease=await acquireBrainUserLease(key,600)
    if(!lease)return NextResponse.json({error:'browser_in_use'},{status:409})
    const task=await readCommerceTask(session.telegramId,runId)
    if(!task)return NextResponse.json({error:'task_unavailable'},{status:404})
    const actor=await resolveAgentActor(session)
    const saved=await runCommerceBrowserRead(actor,task,input.provider as CommerceBrowserProvider,input.action||'read')
    return NextResponse.json(commerceTaskView(saved),{headers:{'Cache-Control':'no-store'}})
  }catch{
    const task=await readCommerceTask(session.telegramId,runId).catch(()=>null)
    return NextResponse.json({error:'browser_read_incomplete',...(task?{task:commerceTaskView(task)}:{})},{status:409,headers:{'Cache-Control':'no-store'}})
  }finally{
    if(lease)await releaseBrainUserLease(key,lease.ownerToken).catch(()=>false)
  }
}
