import { NextResponse } from 'next/server'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { resolveAgentActor } from '@/lib/agent/actor'
import { processNativeCapture } from '@/lib/agent/native-capture'

export const dynamic='force-dynamic'
export const maxDuration=300

export async function POST(request:Request){
  const blocked=requireAgentMutationOrigin(request);if(blocked)return blocked
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  try{
    const actor=await resolveAgentActor(session)
    const form=await request.formData()
    const file=form.get('file')
    if(!(file instanceof File))return NextResponse.json({error:'file_required'},{status:400})
    if(file.size<=0||file.size>24*1024*1024)return NextResponse.json({error:'file_size_invalid'},{status:413})
    const mime=String(file.type||form.get('mime')||'application/octet-stream').slice(0,160)
    const fileName=String(file.name||form.get('fileName')||'capture.bin').slice(0,240)
    const caption=String(form.get('caption')||'').slice(0,1200)
    const bytes=Buffer.from(await file.arrayBuffer())
    const result=await processNativeCapture({telegramId:actor.legacyTelegramId,bytes,mime,fileName,caption})
    return NextResponse.json({ok:true,result})
  }catch(err:any){
    const message=String(err?.message||'')
    console.error('AGENT_NATIVE_CAPTURE_FAILED:',message||err)
    if(message==='unsupported_capture_type')return NextResponse.json({error:message},{status:415})
    if(message.includes('size_invalid'))return NextResponse.json({error:message},{status:413})
    return NextResponse.json({error:'native_capture_failed'},{status:500})
  }
}
