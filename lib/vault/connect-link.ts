import { issueToken } from '@/lib/dashboard/session'
import { findVaultProviderForDomain } from './providers'

export async function buildVaultAddLink(params:{
  telegramId:string|number
  domain:string
  runId?:string|null
}){
  const provider=findVaultProviderForDomain(params.domain)
  if(!provider)return null

  const issued=await issueToken(params.telegramId)
  const base=String(process.env.NEXT_PUBLIC_APP_URL||process.env.APP_URL||'https://app.askgogo.in').replace(/\/$/,'')
  const next=new URL(`/dashboard/you/vault/add/${provider.key}`,base)
  if(params.runId)next.searchParams.set('returnRun',String(params.runId))

  if(!issued.ok){
    return {
      provider,
      url:`${base}/dashboard?next=${encodeURIComponent(next.pathname+next.search)}`,
      code:null,
      tokenIssued:false,
    }
  }

  const url=new URL('/dashboard',base)
  url.searchParams.set('t',issued.token)
  url.searchParams.set('next',next.pathname+next.search)
  return {provider,url:url.toString(),code:issued.code,tokenIssued:true}
}
