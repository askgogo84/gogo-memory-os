import { findVaultProviderForDomain } from './providers'

export async function buildVaultAddLink(params:{
  telegramId:string|number
  domain:string
  runId?:string|null
}){
  const provider=findVaultProviderForDomain(params.domain)
  if(!provider)return null

  const base=String(process.env.NEXT_PUBLIC_APP_URL||process.env.APP_URL||'https://app.askgogo.in').replace(/\/$/,'')
  const next=new URL(`/dashboard/you/vault/add/${provider.key}`,base)
  if(params.runId)next.searchParams.set('returnRun',String(params.runId))

  // This URL is deliberately NOT an authentication credential. If the user is
  // not signed in, the Vault page redirects through the ordinary dashboard
  // login flow and preserves this destination. Never embed a magic-login token
  // in conversation text, model context, Activity, or persisted chat history.
  return {
    provider,
    url:next.toString(),
    tokenIssued:false,
  }
}
