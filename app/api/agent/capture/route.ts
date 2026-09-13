import { randomUUID } from 'crypto'
import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { indexMemory } from '@/lib/services/memory-index'

export const dynamic='force-dynamic'
export const maxDuration=120

const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY})
const BUCKET='user-documents'
const MAX_BYTES=20*1024*1024

function safe(v:unknown,max=1000){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}
function ext(name:string,mime:string){const fromName=(name.match(/\.([a-z0-9]{1,8})$/i)||[])[1];if(fromName)return fromName.toLowerCase();if(/pdf/i.test(mime))return'pdf';if(/png/i.test(mime))return'png';if(/jpe?g/i.test(mime))return'jpg';if(/webp/i.test(mime))return'webp';if(/m4a|mp4/i.test(mime))return'm4a';if(/mpeg|mp3/i.test(mime))return'mp3';if(/wav/i.test(mime))return'wav';return'bin'}
function kindFor(mime:string){if(/^audio\//i.test(mime))return'voice';if(/^image\//i.test(mime))return'image';if(/pdf/i.test(mime))return'pdf';return'document'}

export async function POST(request:Request){
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  const origin=requireAgentMutationOrigin(request);if(origin)return origin
  const form=await request.formData().catch(()=>null);if(!form)return NextResponse.json({error:'invalid_multipart'},{status:400})
  const value=form.get('file');if(!(value instanceof File))return NextResponse.json({error:'file_required'},{status:400})
  if(value.size<=0||value.size>MAX_BYTES)return NextResponse.json({error:'file_size_invalid'},{status:400})
  const mime=safe(value.type||'application/octet-stream',160),name=safe(value.name||'capture.bin',240),caption=safe(form.get('caption'),1200),kind=kindFor(mime),buffer=Buffer.from(await value.arrayBuffer()),telegramId=Number(session.telegramId)
  if(!Number.isFinite(telegramId))return NextResponse.json({error:'invalid_session'},{status:400})
  const path=`${telegramId}/mobile/${randomUUID()}.${ext(name,mime)}`
  const{error:uploadError}=await supabaseAdmin.storage.from(BUCKET).upload(path,buffer,{contentType:mime,upsert:false})
  if(uploadError){console.error('MOBILE_CAPTURE_UPLOAD_FAILED:',uploadError.message);return NextResponse.json({error:'capture_upload_failed'},{status:500})}

  let transcript=''
  if(kind==='voice'){
    if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:'voice_transcription_unavailable'},{status:503})
    try{
      const audioFile=new File([buffer],name,{type:mime})
      const result=await openai.audio.transcriptions.create({file:audioFile,model:'gpt-4o-mini-transcribe'})
      transcript=safe(result.text,12000)
    }catch(err:any){console.error('MOBILE_CAPTURE_TRANSCRIBE_FAILED:',err?.message||err);return NextResponse.json({error:'voice_transcription_failed'},{status:502})}
  }

  const title=kind==='voice'?'Voice note':(caption||name||'Captured document').slice(0,240)
  const summary=kind==='voice'?(transcript||'Voice note captured.'):(caption||`Captured ${kind}: ${name}`)
  const sourceId=`mobile:${randomUUID()}`
  const{data:doc,error:insertError}=await supabaseAdmin.from('documents').insert({telegram_id:telegramId,doc_type:kind==='voice'?'voice_note':kind,title,summary:summary.slice(0,4000),doc_date:null,expires_on:null,storage_path:path,mime,size_bytes:buffer.byteLength,extracted:kind==='voice'?{transcript,source:'mobile_capture'}:{caption:caption||null,filename:name,source:'mobile_capture'},source_message_id:sourceId}).select('id').single()
  if(insertError||!doc?.id){console.error('MOBILE_CAPTURE_INSERT_FAILED:',insertError?.message||'unknown');await supabaseAdmin.storage.from(BUCKET).remove([path]).catch(()=>{});return NextResponse.json({error:'capture_save_failed'},{status:500})}
  await indexMemory({telegramId,sourceId:String(doc.id),sourceTable:'documents',content:`${title}\n${summary}`.slice(0,4000)}).catch(()=>{})

  if(kind==='voice')return NextResponse.json({result:{kind:'voice',transcript}})
  return NextResponse.json({result:{kind:'document',documentId:String(doc.id),title,summary:summary.slice(0,1200),docType:kind,expiresOn:null}})
}
