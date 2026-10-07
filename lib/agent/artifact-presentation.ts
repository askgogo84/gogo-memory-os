import { redactEmailAuthSecrets } from './google-workspace-read'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

export function artifactSections(content:unknown):{title:string;tool:string;text:string}[] {
  const value=content as any
  return (Array.isArray(value?.sections)?value.sections:[]).slice(0,10).map((section:any)=>{
    const result=section?.result||{}
    // Display known prose only; internal IDs, tokens and arbitrary result JSON are not a report.
    const text=typeof result.reply==='string'?result.reply:typeof result.text==='string'?result.text:''
    const sanitize=(s:unknown,max:number)=>redactSecretShapedText(redactEmailAuthSecrets(String(s??'').slice(0,max)))
    return {title:sanitize(section.title||'Result',180),tool:sanitize(section.tool,40),text:sanitize(text||'This step has no readable summary saved.',20000)}
  })
}

export function artifactReply(artifact:{id:string;title:string;content:unknown}) {
  const sections=artifactSections(artifact.content)
  const body=sections.map(section=>`${section.title}\n${section.text}`).join('\n\n')
  const preview=body.length>2800?`${body.slice(0,2700)}\n\nThe full findings are in the private report.`:body
  return `${artifact.title}\n\n${preview||'No completed source results were available.'}\n\nPrivate report: https://app.askgogo.in/dashboard/reports/${encodeURIComponent(artifact.id)}`
}
