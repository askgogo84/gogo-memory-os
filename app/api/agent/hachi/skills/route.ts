import {NextResponse} from 'next/server'
import {isAgentSession,requireAgentMutationOrigin,requireAgentSession} from '@/lib/agent/session'
import {changeSkillReview,listSkillReview,SkillReviewError,type ReviewChange} from '@/lib/agent/governed-review-store'
export const dynamic='force-dynamic'
// Same endpoint for personal and workspace review. Scope and actor are never
// accepted from a model. Optional workspaceId is checked against membership.
export async function POST(request:Request){
  const blocked=requireAgentMutationOrigin(request)
  if(blocked)return blocked
  const session=await requireAgentSession(request)
  if(!isAgentSession(session))return session
  const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store'}})
  let raw:string
  try{raw=await request.text()}catch{return response({error:'invalid_request'},400)}
  if(raw.length>4096)return response({error:'invalid_request'},400)
  let b:any
  try{b=JSON.parse(raw)}catch{return response({error:'invalid_request'},400)}
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['action','workspaceId','skillId','revisionId','expectedGeneration','expectedDigest'].includes(k)))return response({error:'invalid_request'},400)
  if(b.workspaceId!==undefined&&(typeof b.workspaceId!=='string'||!b.workspaceId))return response({error:'invalid_request'},400)
  const scope=b.workspaceId?{kind:'workspace' as const,id:b.workspaceId}:{kind:'personal' as const,id:session.telegramId}
  try{
    if(b.action==='list'){
      if(Object.keys(b).some(k=>k!=='action'&&k!=='workspaceId'))return response({error:'invalid_request'},400)
      return response(await listSkillReview(session.telegramId,scope))
    }
    if(!['publish','rollback'].includes(b.action)||typeof b.skillId!=='string'||typeof b.expectedGeneration!=='number'||typeof b.expectedDigest!=='string'||(b.revisionId!==undefined&&typeof b.revisionId!=='string'))return response({error:'invalid_request'},400)
    const change:ReviewChange={action:b.action,skillId:b.skillId,revisionId:b.revisionId,expectedGeneration:b.expectedGeneration,expectedDigest:b.expectedDigest}
    return response(await changeSkillReview(session.telegramId,scope,change))
  }catch(e){
    if(e instanceof SkillReviewError)return response({error:e.code},e.status)
    return response({error:'review_unavailable'},503)
  }
}
