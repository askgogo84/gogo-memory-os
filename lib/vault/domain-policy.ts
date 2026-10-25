export function normalizeVaultDomain(value:string){
  const raw=String(value||'').trim().toLowerCase()
  if(!raw)return ''
  try{
    const u=new URL(raw.includes('://')?raw:`https://${raw}`)
    const host=u.hostname.replace(/^www\./,'').toLowerCase()
    if(!host||host==='localhost'||host.endsWith('.local'))return ''
    return host
  }catch{return ''}
}

export function vaultDomainAllowed(requested:string,allowedDomains:string[]){
  const host=normalizeVaultDomain(requested)
  if(!host)return false
  return (allowedDomains||[]).some(value=>{
    const allowed=normalizeVaultDomain(value)
    return Boolean(allowed)&&(host===allowed||host.endsWith('.'+allowed))
  })
}
