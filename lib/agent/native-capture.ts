import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { indexMemory } from '@/lib/services/memory-index'

const anthropic=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY!})
const openai=new OpenAI({apiKey:process.env.OPENAI_API_KEY})
const BUCKET='user-documents'
const MAX_BYTES=24*1024*1024

export type NativeCaptureResult=
  | {kind:'voice';transcript:string}
  | {kind:'document';documentId:string|null;title:string;summary:string;docType:string;expiresOn:string|null}

function clean(value:unknown,max=4000){return String(value??'').replace(/\u0000/g,'').trim().slice(0,max)}
function ext(mime:string,name:string){
  const fromName=String(name||'').split('.').pop()?.toLowerCase()
  if(fromName&&/^[a-z0-9]{1,8}$/.test(fromName))return fromName
  const m=String(mime||'').toLowerCase()
  if(m.includes('pdf'))return'pdf';if(m.includes('png'))return'png';if(m.includes('webp'))return'webp';if(m.includes('heic'))return'heic';if(m.includes('jpeg')||m.includes('jpg'))return'jpg';if(m.includes('json'))return'json';if(m.includes('csv'))return'csv';if(m.includes('text'))return'txt';if(m.includes('mp4')||m.includes('m4a'))return'm4a';if(m.includes('wav'))return'wav';if(m.includes('mpeg')||m.includes('mp3'))return'mp3';if(m.includes('webm'))return'webm';return'bin'
}
function parseJson(text:string){const s=String(text||'').replace(/```json|```/g,'').trim();try{return JSON.parse(s)}catch{};const m=s.match(/\{[\s\S]*\}/);if(!m)return null;try{return JSON.parse(m[0])}catch{return null}}
function expiry(value:unknown){const s=clean(value,40);if(!s)return null;if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return null;const d=new Date(`${s}T00:00:00Z`);return Number.isFinite(d.getTime())?s:null}
function normalizeAnalysis(raw:any,fileName:string){
  const title=clean(raw?.title||fileName||'Document',220)||'Document'
  const summary=clean(raw?.summary||'Saved to AskGogo Memory.',3500)||'Saved to AskGogo Memory.'
  const extractedText=clean(raw?.extractedText||raw?.extracted_text||'',12000)
  const allowed=new Set(['document','ticket','id','receipt','medical','screenshot','note','statement','contract','other'])
  const docType=allowed.has(String(raw?.docType||raw?.doc_type||'').toLowerCase())?String(raw?.docType||raw?.doc_type).toLowerCase():'document'
  return{title,summary,extractedText,docType,expiresOn:expiry(raw?.expiresOn||raw?.expires_on)}
}

const ANALYSIS_RULES=`Return JSON only with this shape: {"title":"short useful title","summary":"2-5 sentence useful summary","docType":"document|ticket|id|receipt|medical|screenshot|note|statement|contract|other","extractedText":"key readable text","expiresOn":"YYYY-MM-DD or null"}.
Rules:
- Never invent unreadable values. Use [unclear].
- Do not give medical advice or diagnose. For medical documents, summarize visible facts only.
- A printed date on a receipt/invoice/ID/statement is metadata, not a calendar event.
- expiresOn is only an explicit expiry/valid-until/end date; otherwise null.
- Keep the summary useful but do not echo full passwords, OTPs, CVVs, PINs or API keys even if visible.
- If a long account/document number is visible, the summary should mention the type of identifier without repeating the whole value. The private extractedText may preserve ordinary document text, but never passwords, OTPs, CVVs, PINs or API keys.`

async function analyzeImage(bytes:Buffer,mime:string,fileName:string,caption:string){
  if(!process.env.OPENAI_API_KEY)throw new Error('openai_not_configured')
  const media=mime.includes('png')?'image/png':mime.includes('webp')?'image/webp':'image/jpeg'
  const dataUrl=`data:${media};base64,${bytes.toString('base64')}`
  const res=await openai.chat.completions.create({
    model:'gpt-4o',temperature:0,max_tokens:1200,
    messages:[
      {role:'system',content:'You are AskGogo reading a private image or scanned document for the user. Be precise and privacy-preserving.'},
      {role:'user',content:[{type:'text',text:`File: ${fileName}\nUser caption: ${caption||'none'}\n\n${ANALYSIS_RULES}`},{type:'image_url',image_url:{url:dataUrl,detail:'high'}}]},
    ],
  })
  const text=res.choices?.[0]?.message?.content||''
  return normalizeAnalysis(parseJson(text),fileName)
}

async function analyzePdf(bytes:Buffer,fileName:string,caption:string){
  if(!process.env.ANTHROPIC_API_KEY)throw new Error('anthropic_not_configured')
  const res=await anthropic.messages.create({
    model:'claude-sonnet-4-5',max_tokens:1400,temperature:0,
    messages:[{role:'user',content:[
      {type:'document',source:{type:'base64',media_type:'application/pdf',data:bytes.toString('base64')}} as never,
      {type:'text',text:`You are AskGogo reading a private PDF. File: ${fileName}. User caption: ${caption||'none'}.\n\n${ANALYSIS_RULES}`},
    ]}],
  })
  const text=res.content[0]?.type==='text'?res.content[0].text:''
  return normalizeAnalysis(parseJson(text),fileName)
}

async function analyzeText(bytes:Buffer,fileName:string,caption:string){
  const source=bytes.toString('utf8').slice(0,50000)
  if(!process.env.ANTHROPIC_API_KEY){return normalizeAnalysis({title:fileName,summary:source.slice(0,600),extractedText:source,docType:'note',expiresOn:null},fileName)}
  const res=await anthropic.messages.create({model:'claude-haiku-4-5',max_tokens:1000,temperature:0,messages:[{role:'user',content:`You are AskGogo reading a private text file. File: ${fileName}. User caption: ${caption||'none'}.\n\n${ANALYSIS_RULES}\n\nCONTENT:\n${source}`}]})
  const text=res.content[0]?.type==='text'?res.content[0].text:''
  return normalizeAnalysis(parseJson(text),fileName)
}

async function store(telegramId:number,bytes:Buffer,mime:string,fileName:string,analysis:ReturnType<typeof normalizeAnalysis>){
  const path=`${telegramId}/native/${randomUUID()}.${ext(mime,fileName)}`
  let storagePath:string|null=null
  try{
    const {error}=await supabaseAdmin.storage.from(BUCKET).upload(path,bytes,{contentType:mime||'application/octet-stream',upsert:false})
    if(error)throw error
    storagePath=path
  }catch(err:any){console.error('NATIVE_CAPTURE_UPLOAD_FAILED:',err?.message||err)}
  const {data,error}=await supabaseAdmin.from('documents').insert({
    telegram_id:telegramId,doc_type:analysis.docType,title:analysis.title.slice(0,300),summary:analysis.summary.slice(0,4000),
    doc_date:null,expires_on:analysis.expiresOn,storage_path:storagePath,mime:mime||null,size_bytes:bytes.byteLength,
    extracted:{text:analysis.extractedText,source:'native_app',fileName:fileName.slice(0,240)},source_message_id:null,
  }).select('id').single()
  if(error){console.error('NATIVE_CAPTURE_DOCUMENT_INSERT_FAILED:',error.message);return null}
  const id=String(data?.id||'')||null
  if(id){
    await indexMemory({telegramId,sourceId:id,sourceTable:'documents',content:`${analysis.title}\n${analysis.summary}`.slice(0,2000)}).catch((err:any)=>console.error('NATIVE_CAPTURE_INDEX_FAILED:',err?.message||err))
  }
  return id
}

export async function transcribeNativeVoice(bytes:Buffer,mime:string,fileName:string){
  if(!process.env.OPENAI_API_KEY)throw new Error('openai_not_configured')
  if(!bytes.length||bytes.byteLength>MAX_BYTES)throw new Error('voice_size_invalid')
  const file=new File([bytes],fileName||`gogo-voice.${ext(mime,fileName)}`,{type:mime||'audio/mp4'})
  const result=await openai.audio.transcriptions.create({
    model:'gpt-4o-mini-transcribe',file,response_format:'json',
    prompt:'Transcribe AskGogo voice commands accurately. The user may speak English, Hindi, Hinglish, Kannada, Tamil, Telugu, Malayalam, or mixed Indian languages. Preserve Indian names, times, places, startup terms and brands. Important vocabulary includes AskGogo, CreditIQ, Tipplr, ONDC, GoKhana, Razorpay, Srinivas, Goverdhan, Bengaluru and Bangalore. Preserve reminder intent precisely.',
  })
  const text=clean(result.text,12000);if(!text)throw new Error('voice_transcription_empty');return text
}

export async function processNativeCapture(params:{telegramId:number;bytes:Buffer;mime:string;fileName:string;caption?:string}):Promise<NativeCaptureResult>{
  if(!params.bytes.length||params.bytes.byteLength>MAX_BYTES)throw new Error('capture_size_invalid')
  const mime=String(params.mime||'application/octet-stream').toLowerCase(),caption=clean(params.caption,1200)
  if(mime.startsWith('audio/'))return{kind:'voice',transcript:await transcribeNativeVoice(params.bytes,mime,params.fileName)}
  let analysis
  if(mime.startsWith('image/'))analysis=await analyzeImage(params.bytes,mime,params.fileName,caption)
  else if(mime==='application/pdf'||params.fileName.toLowerCase().endsWith('.pdf'))analysis=await analyzePdf(params.bytes,params.fileName,caption)
  else if(mime.startsWith('text/')||mime.includes('json')||mime.includes('csv'))analysis=await analyzeText(params.bytes,params.fileName,caption)
  else throw new Error('unsupported_capture_type')
  const documentId=await store(params.telegramId,params.bytes,mime,params.fileName,analysis)
  return{kind:'document',documentId,title:analysis.title,summary:analysis.summary,docType:analysis.docType,expiresOn:analysis.expiresOn}
}
