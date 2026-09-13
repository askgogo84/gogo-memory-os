import { createHash, randomUUID } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { recordAgentEvent } from '@/lib/agent/events'
import { isAgentSession, requireAgentMutationOrigin, requireAgentSession } from '@/lib/agent/session'
import { indexMemory } from '@/lib/services/memory-index'

export const dynamic='force-dynamic'
export const maxDuration=120

const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY})
const anthropic=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY})
const BUCKET='user-documents'
const MAX_BYTES=20*1024*1024

function safe(v:unknown,max=1000){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}
function ext(name:string,mime:string){const fromName=(name.match(/\.([a-z0-9]{1,8})$/i)||[])[1];if(fromName)return fromName.toLowerCase();if(/pdf/i.test(mime))return'pdf';if(/png/i.test(mime))return'png';if(/jpe?g/i.test(mime))return'jpg';if(/webp/i.test(mime))return'webp';if(/m4a|mp4/i.test(mime))return'm4a';if(/mpeg|mp3/i.test(mime))return'mp3';if(/wav/i.test(mime))return'wav';return'bin'}
function kindFor(mime:string){if(/^audio\//i.test(mime))return'voice';if(/^image\//i.test(mime))return'image';if(/pdf/i.test(mime))return'pdf';return'document'}
function stableSourceId(raw:string){return raw?`mobile:${createHash('sha256').update(raw).digest('hex').slice(0,40)}`:`mobile:${randomUUID()}`}
async function cleanup(path:string){await supabaseAdmin.storage.from(BUCKET).remove([path]).catch(()=>{})}

async function extractContent(kind:string,mime:string,name:string,caption:string,buffer:Buffer){
  if(kind==='image'&&process.env.OPENAI_API_KEY){
    const dataUrl=`data:${mime};base64,${buffer.toString('base64')}`
    const response=await openai.chat.completions.create({model:'gpt-4o',temperature:0,max_tokens:900,messages:[{role:'user',content:[{type:'text',text:`Read this user-supplied image for AskGogo Memory. Caption: ${caption||'none'}. Return a concise factual summary followed by the key readable text. Preserve uncertainty as [unclear]. Do not invent facts.`},{type:'image_url',image_url:{url:dataUrl,detail:'high'}}]}]})
    return safe(response.choices?.[0]?.message?.content||'',8000)
  }
  if(kind==='pdf'&&process.env.ANTHROPIC_API_KEY){
    const result=await anthropic.messages.create({model:'claude-sonnet-4-5',max_tokens:1000,messages:[{role:'user',content:[{type:'document',source:{type:'base64',media_type:'application/pdf',data:buffer.toString('base64')}} as never,{type:'text',text:`Read this PDF for AskGogo Memory. Caption: ${caption||'none'}. Return a concise factual summary and key readable text, dates, amounts and reference numbers. Use [unclear] rather than guessing.`}]}]})
    return safe(result.content[0]?.type==='text'?result.content[0].text:'',8000)
  }
  if(/^text\//i.test(mime)||/json|csv|xml|markdown/i.test(mime)||/\.(txt|md|csv|json|xml)$/i.test(name))return safe(buffer.toString('utf8'),8000)
  return ''
}

export async function POST(request:Request){
  const session=await requireAgentSession(request);if(!isAgentSession(session))return session
  const origin=requireAgentMutationOrigin(request);if(origin)return origin
  const form=await request.formData().catch(()=>null);if(!form)return NextResponse.json({error:'invalid_multipart'},{status:400})
  const value=form.get('file');if(!(value instanceof File))return NextResponse.json({error:'file_required'},{status:400})
  if(value.size<=0||value.size>MAX_BYTES)return NextResponse.json({error:'file_size_invalid'},{status:400})
  const mime=safe(value.type||'application/octet-stream',160),name=safe(value.name||'capture.bin',240),caption=safe(form.get('caption'),1200),kind=kindFor(mime),buffer=Buffer.from(await value.arrayBuffer()),telegramId=Number(session.telegramId)
  if(!Number.isFinite(telegramId))return NextResponse.json({error:'invalid_session'},{status:400})
  const sourceId=stableSourceId(safe(form.get('idempotencyKey'),1200))

  const {data:existing}=await supabaseAdmin.from('documents').select('id,title,summary,doc_type,expires_on').eq('telegram_id',telegramId).eq('source_message_id',sourceId).maybeSingle()
  if(existing)return NextResponse.json({result:{kind:'document',documentId:String(existing.id),title:String(existing.title||name),summary:String(existing.summary||''),docType:String(existing.doc_type||kind),expiresOn:existing.expires_on||null,deduplicated:true}})

  const path=`${telegramId}/mobile/${randomUUID()}.${ext(name,mime)}`
  const{error:uploadError}=await supabaseAdmin.storage.from(BUCKET).upload(path,buffer,{contentType:mime,upsert:false})
  if(uploadError){console.error('MOBILE_CAPTURE_UPLOAD_FAILED:',uploadError.message);return NextResponse.json({error:'capture_upload_failed'},{status:500})}

  let transcript=''
  if(kind==='voice'){
    if(!process.env.OPENAI_API_KEY){await cleanup(path);return NextResponse.json({error:'voice_transcription_unavailable'},{status:503})}
    try{
      const audioFile=new File([buffer],name,{type:mime})
      const result=await openai.audio.transcriptions.create({file:audioFile,model:'gpt-4o-mini-transcribe'})
      transcript=safe(result.text,12000)
    }catch(err:any){console.error('MOBILE_CAPTURE_TRANSCRIBE_FAILED:',err?.message||err);await cleanup(path);return NextResponse.json({error:'voice_transcription_failed'},{status:502})}
  }

  let extractedText=''
  if(kind!=='voice'){
    try{extractedText=await extractContent(kind,mime,name,caption,buffer)}catch(err:any){console.error('MOBILE_CAPTURE_EXTRACT_FAILED:',err?.message||err)}
  }
  const title=kind==='voice'?'Voice note':(caption||name||'Captured document').slice(0,240)
  const summary=kind==='voice'?(transcript||'Voice note captured.'):(extractedText||caption||`Captured ${kind}: ${name}`)
  const extracted=kind==='voice'?{transcript,source:'mobile_capture'}:{text:extractedText||null,caption:caption||null,filename:name,source:'mobile_capture'}
  const{data:doc,error:insertError}=await supabaseAdmin.from('documents').insert({telegram_id:telegramId,doc_type:kind==='voice'?'voice_note':kind,title,summary:summary.slice(0,4000),doc_date:null,expires_on:null,storage_path:path,mime,size_bytes:buffer.byteLength,extracted,source_message_id:sourceId}).select('id').single()
  if(insertError||!doc?.id){
    if((insertError as any)?.code==='23505'){
      await cleanup(path)
      const {data:dupe}=await supabaseAdmin.from('documents').select('id,title,summary,doc_type,expires_on').eq('telegram_id',telegramId).eq('source_message_id',sourceId).maybeSingle()
      if(dupe)return NextResponse.json({result:{kind:'document',documentId:String(dupe.id),title:String(dupe.title||name),summary:String(dupe.summary||''),docType:String(dupe.doc_type||kind),expiresOn:dupe.expires_on||null,deduplicated:true}})
    }
    console.error('MOBILE_CAPTURE_INSERT_FAILED:',insertError?.message||'unknown');await cleanup(path);return NextResponse.json({error:'capture_save_failed'},{status:500})
  }
  await indexMemory({telegramId,sourceId:String(doc.id),sourceTable:'documents',content:`${title}\n${summary}\n${extractedText}`.slice(0,8000)}).catch(()=>{})
  await recordAgentEvent({telegramId,eventType:'memory_saved',sourceType:'document',sourceId:String(doc.id),title:`Saved to Memory: ${title}`,body:summary.slice(0,1200),payload:{kind,mime,filename:name},surface:session.surface,importance:1})

  if(kind==='voice')return NextResponse.json({result:{kind:'voice',transcript}})
  return NextResponse.json({result:{kind:'document',documentId:String(doc.id),title,summary:summary.slice(0,1200),docType:kind,expiresOn:null}})
}
