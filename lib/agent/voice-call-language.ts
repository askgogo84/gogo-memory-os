import { sarvamEnabled } from '../services/sarvam-gate'
import { exactSessionOwnerId } from '../dashboard/owner-identity'

export type CallLanguage = 'Hindi' | 'Kannada'
type Env = Record<string,string|undefined>

const profileKeys = {
  Hindi: { table:'BOLNA_SARVAM_HI_TABLE_AGENT_ID', general:'BOLNA_SARVAM_HI_GENERAL_AGENT_ID' },
  Kannada: { table:'BOLNA_SARVAM_KN_TABLE_AGENT_ID', general:'BOLNA_SARVAM_KN_GENERAL_AGENT_ID' },
} as const

/** Only a pre-provisioned profile for the exact task kind and language may take this call. */
export function sarvamCallProfile(owner: string | number | undefined, language: unknown, kind: unknown, env: Env = process.env): string | null {
  const id = exactSessionOwnerId(owner)
  if (!id || (language !== 'Hindi' && language !== 'Kannada') || (kind !== 'table' && kind !== 'general')) return null
  if (!sarvamEnabled('GOGO_SARVAM_CALLS',env,id) || !sarvamEnabled('GOGO_SARVAM_STT',env,id) ||
      !sarvamEnabled('GOGO_SARVAM_TTS',env,id)) return null
  const key = profileKeys[language][kind]
  const profile = env[key]?.trim().toLowerCase()
  if (!profile || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(profile)) return null
  const otherKeys = ['BOLNA_AGENT_ID','BOLNA_GENERAL_AGENT_ID',...Object.values(profileKeys).flatMap(group=>Object.values(group))]
  if (otherKeys.some(other=>other!==key && env[other]?.trim().toLowerCase()===profile)) return null
  return profile
}
