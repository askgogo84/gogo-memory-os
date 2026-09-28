// Literal field requests require complete local coverage. Other draft workflows
// retain their domain-specific checks; a partial literal parse is never accepted.
export function draftObjectiveCovered(objective:string,page:any,actions:any[]):boolean|null{
  const match=objective.trim().match(/^(?:prepare|fill) (?:the )?(?:application|form|draft) with ([\s\S]+?)(?:\. (?:Do not submit|Stop before submit)\.?)?$/i)
  if(!match)return /\b(?:name|email|field|address|phone)\s*:\s*"/i.test(objective)?false:null
  let rest=match[1].trim()
  const requirements:Array<{label:string;value:string}>=[]
  while(rest){
    const field=rest.match(/^([A-Za-z][A-Za-z0-9 _-]{0,59}):\s*"([^"\r\n]{1,500})"/)
    if(!field)return false
    requirements.push({label:field[1].trim().toLowerCase(),value:field[2]})
    rest=rest.slice(field[0].length).trim()
    if(!rest)break
    const separator=rest.match(/^(?:,\s*(?:and\s+)?|and\s+)/i)
    if(!separator)return false
    rest=rest.slice(separator[0].length).trim()
    if(!rest)return false
  }
  if(!requirements.length||new Set(requirements.map(field=>field.label)).size!==requirements.length)return false
  const inputs=(page.forms||[]).flatMap((form:any)=>form.inputs||[])
  const fieldActions=actions.filter(action=>['fill','select','check'].includes(action.kind))
  if(fieldActions.length!==requirements.length)return false
  const used=new Set<string>()
  return requirements.every(required=>{
    const candidates=inputs.filter((input:any)=>[input.label,input.name].some(label=>String(label||'').trim().toLowerCase()===required.label))
    const selectors=[...new Set<string>(candidates.map((input:any)=>String(input.selector||'')))]
    if(selectors.length!==1||!selectors[0]||used.has(selectors[0]))return false
    used.add(selectors[0])
    return fieldActions.some(action=>action.selector===selectors[0]&&(
      ['fill','select'].includes(action.kind)&&action.value===required.value
      ||action.kind==='check'&&/^(?:checked|true)$/i.test(required.value)&&candidates.every((input:any)=>input.type==='checkbox')
    ))
  })
}
