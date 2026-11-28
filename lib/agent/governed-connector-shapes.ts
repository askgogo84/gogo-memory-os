// Pure protocol constraints. The operation is chosen by existing trusted
// server adapters, never from a model's URL or an arbitrary HTTP tool.
export const GOOGLE_OPERATIONS=['google.calendar.refresh','google.calendar.read','google.workspace.refresh','google.gmail.read','google.drive.read','google.contacts.read'] as const
export type GoogleOperation=typeof GOOGLE_OPERATIONS[number]
export type GoogleRequest={operation:GoogleOperation;url:string;method:'GET'|'POST';credential:string}
const ID='[A-Za-z0-9_.@%+-]{1,1024}'
const calendar=new RegExp('^/calendar/v3/calendars/primary/events(?:/'+ID+')?$')
const gmail=new RegExp('^/gmail/v1/users/me/(?:profile|messages(?:/'+ID+'(?:/attachments/'+ID+')?)?|threads(?:/'+ID+')?)$')
const drive=new RegExp('^/drive/v3/files(?:/'+ID+'(?:/export)?)?$')
const contacts=/^\/v1\/people:searchContacts$/
const urlParams:Record<string,string[]>={
  'google.calendar.read':['timeMin','timeMax','singleEvents','orderBy','maxResults','fields','pageToken','timeZone','showDeleted','q'],
  'google.gmail.read':['maxResults','labelIds','q','pageToken','format','metadataHeaders','fields','includeSpamTrash'],
  'google.drive.read':['q','fields','pageSize','pageToken','orderBy','spaces','alt','mimeType','supportsAllDrives','includeItemsFromAllDrives','corpora','driveId'],
  'google.contacts.read':['query','readMask','pageSize','sources']
}
function boundedInt(raw:string|null,max:number){return raw===null||/^[1-9]\d{0,3}$/.test(raw)&&Number(raw)<=max}
export function googleRequestShape(operation:GoogleOperation,raw:string,init:RequestInit={}):GoogleRequest|null{
  if(!(GOOGLE_OPERATIONS as readonly string[]).includes(operation)||typeof raw!=='string'||raw.length>16_000)return null
  let u:URL
  try{u=new URL(raw)}catch{return null}
  if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port||/%(?:2f|5c|00|0a|0d)/i.test(u.pathname))return null
  const method=String(init.method||'GET').toUpperCase()
  if(operation.endsWith('.refresh')){
    if(method!=='POST'||u.href!=='https://oauth2.googleapis.com/token')return null
    const body=init.body instanceof URLSearchParams?new URLSearchParams(init.body):typeof init.body==='string'?new URLSearchParams(init.body):null
    if(!body||body.toString().length>16_000)return null
    const keys=[...body.keys()]
    if(keys.length!==4||new Set(keys).size!==4||!keys.every(k=>['refresh_token','client_id','client_secret','grant_type'].includes(k))||body.get('grant_type')!=='refresh_token'||!body.get('client_id')||!body.get('client_secret'))return null
    const token=body.get('refresh_token')
    return token&&token.length<=8192?{operation,url:u.href,method:'POST',credential:token}:null
  }
  if(method!=='GET'||init.body!=null)return null
  let accepted=false
  if(operation==='google.calendar.read')accepted=u.hostname==='www.googleapis.com'&&calendar.test(u.pathname)&&boundedInt(u.searchParams.get('maxResults'),250)
  if(operation==='google.gmail.read')accepted=u.hostname==='gmail.googleapis.com'&&gmail.test(u.pathname)&&boundedInt(u.searchParams.get('maxResults'),100)
  if(operation==='google.drive.read')accepted=u.hostname==='www.googleapis.com'&&drive.test(u.pathname)&&boundedInt(u.searchParams.get('pageSize'),100)
  if(operation==='google.contacts.read')accepted=u.hostname==='people.googleapis.com'&&contacts.test(u.pathname)&&boundedInt(u.searchParams.get('pageSize'),30)
  if(!accepted||[...u.searchParams.keys()].some(k=>!(urlParams[operation]||[]).includes(k)))return null
  for(const [key,value] of u.searchParams)if(value.length>6000||!['metadataHeaders','labelIds','sources'].includes(key)&&u.searchParams.getAll(key).length>1)return null
  let auth:string|null
  try{auth=new Headers(init.headers).get('authorization')}catch{return null}
  const token=/^Bearer ([^\s]{1,8192})$/.exec(auth||'')?.[1]
  return token?{operation,url:u.href,method:'GET',credential:token}:null
}
export function googleReadOperation(url:string):GoogleOperation|null{
  try{
    const u=new URL(url)
    if(u.origin==='https://gmail.googleapis.com')return 'google.gmail.read'
    if(u.origin==='https://people.googleapis.com')return 'google.contacts.read'
    if(u.origin==='https://www.googleapis.com'&&u.pathname.startsWith('/drive/v3/'))return 'google.drive.read'
    if(u.origin==='https://www.googleapis.com'&&u.pathname.startsWith('/calendar/v3/'))return 'google.calendar.read'
  }catch{}
  return null
}
