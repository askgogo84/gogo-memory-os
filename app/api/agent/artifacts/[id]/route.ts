import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { agentRunRefOf, applyOwnerEdit, parseArtifactEdit } from '@/lib/agent/artifact-versions'

export const dynamic='force-dynamic'

const MAX_BODY_CHARS=260_000

export async function GET(request:Request,context:{params:Promise<{id:string}>}){
  const session=await requireAgentSession(request)
  if(!isAgentSession(session))return session
  const {id}=await context.params
  if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'invalid_artifact'},{status:400})
  const {data,error}=await supabaseAdmin.from('agent_artifacts')
    .select('id,type,title,subtitle,schema_version,content_json,source_refs,created_at,updated_at')
    .eq('id',id).eq('telegram_id',session.telegramId).maybeSingle()
  if(error){console.error('AGENT_ARTIFACT_READ_FAILED:',error);return NextResponse.json({error:'read_failed'},{status:500})}
  if(!data)return NextResponse.json({error:'artifact_not_found'},{status:404})
  return NextResponse.json({artifact:{
    id:data.id,type:data.type,title:data.title,subtitle:data.subtitle,schemaVersion:data.schema_version,
    content:data.content_json||{},sourceRefs:Array.isArray(data.source_refs)?data.source_refs:[],createdAt:data.created_at,updatedAt:data.updated_at,
  }})
}

// Make v2: the owner edits a saved result. Same-origin for browsers, bearer for the apps; owner-scoped on every query.
// The previous version is kept in content_json.versions (last 10) and edited section titles in content_json.userEdits,
// so a later Gogo regeneration keeps the owner's text.
export async function PATCH(request:Request,context:{params:Promise<{id:string}>}){
  const blocked=requireAgentMutationOrigin(request)
  if(blocked)return blocked
  const session=await requireAgentSession(request)
  if(!isAgentSession(session))return session
  const {id}=await context.params
  if(!/^[0-9a-f-]{36}$/i.test(id))return NextResponse.json({error:'invalid_artifact'},{status:400})
  const raw=await request.text().catch(()=> '')
  if(raw.length>MAX_BODY_CHARS)return NextResponse.json({error:'body_too_large'},{status:413})
  let body:unknown=null
  try{body=JSON.parse(raw)}catch{return NextResponse.json({error:'invalid_body'},{status:400})}
  const parsed=parseArtifactEdit(body)
  if('error' in parsed)return NextResponse.json({error:parsed.error},{status:400})
  try{
    const actor=await resolveAgentActor(session)
    const {data:row,error}=await supabaseAdmin.from('agent_artifacts')
      .select('id,title,content_json,source_refs,updated_at')
      .eq('id',id).eq('telegram_id',session.telegramId).maybeSingle()
    if(error)throw new Error(`artifact_edit_read_failed:${error.message}`)
    if(!row)return NextResponse.json({error:'artifact_not_found'},{status:404})
    const applied=applyOwnerEdit(row,parsed.edit,String(actor.userId))
    if('error' in applied)return NextResponse.json({error:applied.error},{status:applied.error==='nothing_to_change'?409:400})
    const now=String((applied.content_json as any).editedAt)
    // Only lands if nobody (Gogo or another tab) changed the result since it was read; otherwise ask to reload.
    let write=supabaseAdmin.from('agent_artifacts').update({title:applied.title,content_json:applied.content_json,updated_at:now})
      .eq('id',id).eq('telegram_id',session.telegramId)
    write=row.updated_at?write.eq('updated_at',row.updated_at):write.is('updated_at',null)
    const {data:written,error:writeError}=await write.select('id,updated_at')
    if(writeError)throw new Error(`artifact_edit_write_failed:${writeError.message}`)
    if(!Array.isArray(written)||!written.length)return NextResponse.json({error:'changed_since_loaded'},{status:409})
    const {error:activityError}=await supabaseAdmin.from('agent_activity').insert({
      telegram_id:session.telegramId,run_id:agentRunRefOf(row.source_refs),event_type:'artifact_edited',
      message:`Edited by you — ${String(applied.title).slice(0,200)}`,
      metadata_json:{artifact_id:id,by:String(actor.userId),surface:session.surface,sections:applied.changedSections,
        title_changed:applied.title!==String(row.title||''),notes_changed:parsed.edit.notes!==undefined},
    })
    if(activityError)console.error('ARTIFACT_EDIT_ACTIVITY_FAILED:',activityError.message)
    return NextResponse.json({ok:true,updatedAt:now,changedSections:applied.changedSections})
  }catch(err:any){
    console.error('ARTIFACT_EDIT_FAILED:',String(err?.message||err).slice(0,200))
    return NextResponse.json({error:'edit_failed'},{status:500})
  }
}
