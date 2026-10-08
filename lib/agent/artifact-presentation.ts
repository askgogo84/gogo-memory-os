import { formatEmailSnippet } from './google-workspace-read'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

// Only explicit public research citations may bypass identifier-shaped prose
// redaction. Credentials, authenticated queries and fragments never qualify.
export function publicResearchUrl(value:unknown):string {
  if(typeof value!=='string' || value.length>2000)return ''
  try {
    const url=new URL(value)
    if(!/^https?:$/.test(url.protocol)||url.username||url.password||url.hash)return ''
    if([...url.searchParams.keys()].some(key=>/token|key|auth|session|secret|signature|password|credential|^sig$|^code$/i.test(key)))return ''
    return value
  }catch{return ''}
}

export function researchReportText(value:unknown,sourceUrls:unknown[],max=20000):string {
  let text=String(value??'')
  const urls=[...new Set(sourceUrls.map(publicResearchUrl).filter(Boolean))].sort((a,b)=>b.length-a.length)
  const replacements:Record<string,string>={}
  for(const [i,url] of urls.entries()) {
    const marker=`PUBLICCITATIONREF_${i}_END`
    if(text.includes(url)){text=text.split(url).join(marker);replacements[marker]=url}
  }
  text=text.split('\n').map(line=>redactSecretShapedText(formatEmailSnippet(line,max))).join('\n')
  for(const [marker,url] of Object.entries(replacements))text=text.split(marker).join(url)
  return text.slice(0,max)
}

export function artifactSections(content:unknown):{title:string;tool:string;text:string}[] {
  const value=content as any
  return (Array.isArray(value?.sections)?value.sections:[]).slice(0,10).map((section:any)=>{
    const result=section?.result||{}
    // Display known prose only; internal IDs, tokens and arbitrary result JSON are not a report.
    const text=typeof result.reply==='string'?result.reply:typeof result.text==='string'?result.text:''
    const sanitize=(s:unknown,max:number)=>String(s??'').split('\n').map(line=>redactSecretShapedText(formatEmailSnippet(line,max))).join('\n').slice(0,max)
    return {title:sanitize(section.title||'Result',180),tool:sanitize(section.tool,40),text:researchReportText(text||'This step has no readable summary saved.',Array.isArray(result.sourceUrls)?result.sourceUrls:[],20000)}
  })
}

export function artifactReply(artifact:{id:string;title:string;content:unknown}) {
  const sections=artifactSections(artifact.content)
  const body=sections.map(section=>`${section.title}\n${section.text}`).join('\n\n')
  const preview=body.length>2800?`${body.slice(0,2700)}\n\nThe full findings are in the private report.`:body
  return `${artifact.title}\n\n${preview||'No completed source results were available.'}\n\nPrivate report: https://app.askgogo.in/dashboard/reports/${encodeURIComponent(artifact.id)}`
}
