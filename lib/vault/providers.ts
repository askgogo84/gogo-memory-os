export type VaultProvider = {
  key:string
  label:string
  aliases?:string[]
  domains:string[]
  loginUrl:string
  usernameLabel:string
  secretLabel:string
  note:string
}

export const VAULT_PROVIDERS:Record<string,VaultProvider>={
  instagram:{
    key:'instagram',label:'Instagram',aliases:['instagram','insta'],domains:['instagram.com'],
    loginUrl:'https://www.instagram.com/accounts/login/',
    usernameLabel:'Username, email or phone',secretLabel:'Password',
    note:'Used only on instagram.com through Gogo’s secure browser.',
  },
  facebook:{
    key:'facebook',label:'Facebook',aliases:['facebook','fb'],domains:['facebook.com'],
    loginUrl:'https://www.facebook.com/login/',
    usernameLabel:'Email or phone',secretLabel:'Password',
    note:'Used only on facebook.com through Gogo’s secure browser.',
  },
  linkedin:{
    key:'linkedin',label:'LinkedIn',aliases:['linkedin','linked in'],domains:['linkedin.com'],
    loginUrl:'https://www.linkedin.com/login',
    usernameLabel:'Email or phone',secretLabel:'Password',
    note:'Used only on linkedin.com through Gogo’s secure browser.',
  },
  amazon:{
    key:'amazon',label:'Amazon India',aliases:['amazon','amazon india'],domains:['amazon.in'],
    loginUrl:'https://www.amazon.in/ap/signin',
    usernameLabel:'Email or mobile number',secretLabel:'Password',
    note:'Used only on amazon.in through Gogo’s secure browser.',
  },
  flipkart:{
    key:'flipkart',label:'Flipkart',aliases:['flipkart'],domains:['flipkart.com'],
    loginUrl:'https://www.flipkart.com/account/login',
    usernameLabel:'Email or mobile number',secretLabel:'Password',
    note:'Used only on flipkart.com through Gogo’s secure browser.',
  },
  irctc:{
    key:'irctc',label:'IRCTC',aliases:['irctc'],domains:['irctc.co.in'],
    loginUrl:'https://www.irctc.co.in/nget/train-search',
    usernameLabel:'IRCTC user ID',secretLabel:'Password',
    note:'IRCTC may still require CAPTCHA/OTP or may block cloud browsers. Gogo will hand control to you when needed.',
  },
  booking:{
    key:'booking',label:'Booking.com',aliases:['booking.com','booking'],domains:['booking.com'],
    loginUrl:'https://account.booking.com/sign-in',
    usernameLabel:'Email',secretLabel:'Password',
    note:'Used only on booking.com through Gogo’s secure browser.',
  },
}

export function getVaultProvider(key:string){
  return VAULT_PROVIDERS[String(key||'').toLowerCase()]||null
}


export function findVaultProviderForDomain(domain:string){
  const host=String(domain||'').toLowerCase().replace(/^www\./,'')
  if(!host)return null
  return Object.values(VAULT_PROVIDERS).find(provider=>
    provider.domains.some(value=>host===value||host.endsWith('.'+value))
  )||null
}

export function findVaultProviderInText(text:string){
  const raw=String(text||'').toLowerCase()
  if(!raw)return null
  const normalized=' '+raw.replace(/[^a-z0-9.]+/g,' ').replace(/\s+/g,' ').trim()+' '
  return Object.values(VAULT_PROVIDERS).find(provider=>
    (provider.aliases||[provider.key]).some(alias=>{
      const a=String(alias||'').toLowerCase().trim()
      if(!a)return false
      if(a.includes('.'))return raw.includes(a)
      return normalized.includes(' '+a+' ')
    })
  )||null
}
