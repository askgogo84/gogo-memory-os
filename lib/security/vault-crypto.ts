import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const PREFIX='vault:v1'
const IV_BYTES=12
const TAG_BYTES=16

function keyBytes():Buffer {
  const raw=String(process.env.VAULT_MASTER_KEY_V1||'').trim()
  if(!raw)throw new Error('vault_master_key_missing')
  const key=Buffer.from(raw,'base64')
  if(key.length!==32)throw new Error('vault_master_key_invalid')
  return key
}

export function hasVaultMasterKey(){
  try{return keyBytes().length===32}catch{return false}
}

export function encryptVaultValue(value:string){
  const plain=String(value||'')
  if(!plain)return ''
  const key=keyBytes()
  const iv=randomBytes(IV_BYTES)
  const cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:TAG_BYTES})
  const ciphertext=Buffer.concat([cipher.update(plain,'utf8'),cipher.final()])
  const tag=cipher.getAuthTag()
  return [PREFIX,iv.toString('base64url'),tag.toString('base64url'),ciphertext.toString('base64url')].join(':')
}

export function decryptVaultValue(value:string|null|undefined){
  const stored=String(value||'')
  if(!stored)return ''
  const parts=stored.split(':')
  if(parts.length!==5||parts[0]!=='vault'||parts[1]!=='v1')throw new Error('vault_ciphertext_invalid')
  const [, , ivPart,tagPart,cipherPart]=parts
  const iv=Buffer.from(ivPart,'base64url')
  const tag=Buffer.from(tagPart,'base64url')
  const ciphertext=Buffer.from(cipherPart,'base64url')
  if(iv.length!==IV_BYTES||tag.length!==TAG_BYTES||!ciphertext.length)throw new Error('vault_ciphertext_invalid')
  const decipher=createDecipheriv('aes-256-gcm',keyBytes(),iv,{authTagLength:TAG_BYTES})
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8')
}

export function vaultHint(value:string){
  const raw=String(value||'').trim()
  if(!raw)return ''
  if(raw.includes('@')){
    const [local,domain]=raw.split('@')
    const masked=local.length<=2?local[0]+'*':local.slice(0,2)+'***'
    return `${masked}@${domain}`
  }
  if(/\d/.test(raw)){
    const digits=raw.replace(/\D/g,'')
    return digits.length>4?`••••${digits.slice(-4)}`:'••••'
  }
  return raw.length<=3?raw[0]+'••':raw.slice(0,2)+'•••'
}
