// Internal specialist outputs only. This never grants action permission.
export function verifiedReadEvidence(handler:string,status:unknown,value:any){
  const allowed=(handler==='watcher-status'&&value?.source==='canonical_watchers')||(handler==='gmail-verification'&&value?.source==='gmail')
  return Boolean(allowed&&status==='completed'&&value?.kind==='read'&&value?.verified===true&&value?.objectKind)
}
