// Scoped, read-only discovery over actual registered definitions; descriptions
// are not execution grants, provider status or new permissions.
import { BUILTIN_SKILLS } from './skills-builtin'
import { recoverySkillDefinitions } from './governed-learning-candidates'
import { previewSkills, searchSkillIndex } from './skill-discovery'
import type { SkillDefinition } from './skill-registry'
import type { AgentCapability, AgentPermissionLevel } from './policy'
const ref=(d:SkillDefinition)=>({id:d.id,version:d.sopVersion})
const key=(d:SkillDefinition)=>d.id+'@'+d.sopVersion
export function skillQuery(text:string):string|null {
  const m=/^(?:show|list|find|search)\s+(?:(?:my|available|workspace)\s+)?skills?(?:\s+(?:for\s+)?(.{1,160}))?[.!?]?$/i.exec(text.trim())
  return m?(m[1]||'').trim():null
}
const personal=[...BUILTIN_SKILLS.map(x=>x.def).filter(d=>d.id==='people.brief'||d.id==='thread.reply'),...recoverySkillDefinitions()]
const workspace:SkillDefinition[]=[
  {id:'workspace.shared.reports',sopVersion:'1.0.0',title:'Explicitly shared workspace reports',purpose:'List the titles of reports still explicitly shared by current workspace members. No personal source or document contents are queried.',input:{},output:{},limits:{maxSteps:1,maxMinutes:1,maxCostPaise:0},requiredCapabilities:['files'],exactActionApproval:false,evidence:['ledger_row'],risk:'low',irreversible:false},
  {id:'workspace.orders.summary',sopVersion:'1.0.0',title:'Recorded orders and cancellations',purpose:'All-history recorded order totals and cancellations in the read-only hospitality workspace pilot.',input:{},output:{},limits:{maxSteps:1,maxMinutes:1,maxCostPaise:0},requiredCapabilities:['merchant'],exactActionApproval:false,evidence:['ledger_row'],risk:'low',irreversible:false},
  {id:'workspace.stock.summary',sopVersion:'1.0.0',title:'Recorded stock availability',purpose:'Recorded menu item availability across the member’s pilot outlets; not live POS status.',input:{},output:{},limits:{maxSteps:1,maxMinutes:1,maxCostPaise:0},requiredCapabilities:['merchant'],exactActionApproval:false,evidence:['ledger_row'],risk:'low',irreversible:false},
  {id:'workspace.incident.review',sopVersion:'1.0.0',title:'Recorded cancellation review',purpose:'Propose an internal review for an exact recorded order; a different owner/admin must confirm the proposal. No POS, stock, refund or external action.',input:{},output:{},limits:{maxSteps:1,maxMinutes:1,maxCostPaise:0},requiredCapabilities:['merchant'],exactActionApproval:true,evidence:['ledger_row'],risk:'medium',irreversible:false}
]
export function catalogBaseDefinitions(kind:'personal'|'workspace'):SkillDefinition[]{return [...(kind==='personal'?personal:workspace)]}
function render(defs:readonly SkillDefinition[],query:string,allowed:Set<string>):string{
  const refs=query?searchSkillIndex(defs,query,allowed).map(x=>({id:x.id,version:x.version})):defs.map(ref)
  const descriptions=previewSkills(defs,refs,allowed)
  if(!descriptions.length)return 'No matching skill descriptions are available in this scope.'
  return ['Skill catalog (descriptions only; no action or provider connection verified):',...descriptions.map(d=>{
    const title=defs.find(x=>x.id===d.id&&x.sopVersion===d.version)?.title||d.id
    return '• '+title+' ('+d.id+' v'+d.version+'): '+d.purpose
  })].join('\n')
}
export async function personalSkillCatalog(query:string,permission:(c:AgentCapability)=>Promise<AgentPermissionLevel>,reviewed:readonly SkillDefinition[]=personal):Promise<string>{
  const allowed=new Set<string>()
  for(const d of reviewed){
    try{
      const levels=await Promise.all(d.requiredCapabilities.map(permission))
      if(levels.every(x=>['read','draft','ask','auto'].includes(x)))allowed.add(key(d))
    }catch{/* missing permission data hides the skill */}
  }
  return render(reviewed,query,allowed)
}
export function workspaceSkillCatalog(query:string,pilotEnabled:boolean,reviewed:readonly SkillDefinition[]=workspace):string{
  return render(reviewed,query,new Set(reviewed.filter(d=>pilotEnabled||d.id==='workspace.shared.reports').map(key)))
}
