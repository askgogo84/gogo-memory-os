// Invite links: pure helpers (no database). Client-safe except makeInviteCode (node crypto).
// One private code per user, e.g. goverdhan-7k2m9x; up to INVITE_LIMIT new numbers can join with it.
import { waLink } from '@/lib/product-urls'

export const INVITE_LIMIT = 10
export const INVITE_BASE_URL = 'https://app.askgogo.in/i/'
// No 0/o, 1/l/i: codes get read out and retyped.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const CODE_RE = /^[a-z0-9]{1,12}-[a-z0-9]{6}$/

export function inviteSlug(name?: string | null): string {
  const first = String(name || '').trim().split(/\s+/)[0] || ''
  const slug = first.normalize('NFKD').toLowerCase().replace(/[^a-z]/g, '').slice(0, 10)
  return slug && slug !== 'friend' ? slug : 'gogo'
}

export function makeInviteCode(name: string | null | undefined, randomInt: (max: number) => number): string {
  let tail = ''
  for (let i = 0; i < 6; i++) tail += ALPHABET[randomInt(ALPHABET.length)]
  return `${inviteSlug(name)}-${tail}`
}

export function normalizeInviteCode(value: string | null | undefined): string | null {
  const code = String(value || '').trim().toLowerCase()
  return CODE_RE.test(code) ? code : null
}

/** The code in a join message ("Hi Gogo, I'm joining with invite goverdhan-7k2m9x"). Needs the word "invite". */
export function extractInviteCode(text: string | null | undefined): string | null {
  const m = String(text || '').match(/\binvite\b[^a-z0-9]{0,3}(?:code[^a-z0-9]{0,3})?([a-z0-9]{1,12}-[a-z0-9]{6})(?![a-z0-9-])/i)
  return m ? normalizeInviteCode(m[1]) : null
}

export const inviteUrl = (code: string) => `${INVITE_BASE_URL}${code}`
export const joinMessage = (code: string) => `Hi Gogo, I'm joining with invite ${code}`
export const joinWhatsAppLink = (code: string) => waLink(joinMessage(code))

export function firstName(name?: string | null): string | null {
  const first = String(name || '').trim().split(/\s+/)[0] || ''
  if (!first || /^friend$/i.test(first)) return null
  return first.slice(0, 30)
}

export function maskPhone(phone: string): string {
  const d = String(phone || '').replace(/\D/g, '')
  if (d.length < 7) return 'a friend'
  const cc = d.length > 10 ? `+${d.slice(0, d.length - 10)} ` : ''
  const local = d.slice(-10)
  return `${cc}${local.slice(0, 2)}•••••${local.slice(-3)}`
}

const norm = (text: string) => String(text || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim()

const LINK_PHRASES = new Set([
  'invite', 'invites link', 'invite link', 'my invite link', 'my invite', 'send me my invite link', 'send my invite link', 'send me invite link',
  'send me the invite link', 'give me my invite link', 'get my invite link', 'share my invite link', 'invite friends', 'invite friend',
  'invite a friend', 'invite my friends', 'invite someone', 'invite frnds', 'invite frnd', 'refer', 'refer a friend', 'refer friends',
  'referral', 'my referral', 'referral link', 'my referral link', 'share askgogo',
])
const STATUS_PHRASES = new Set([
  'my invites', 'invites', 'who joined', 'who joined with my invite', 'invite status', 'my invite status', 'referral status',
  'my referral status', 'how many invites', 'how many invites do i have', 'how many invites left', 'invites left',
])
export const isInviteLinkCommand = (text: string) => LINK_PHRASES.has(norm(text))
export const isMyInvitesCommand = (text: string) => STATUS_PHRASES.has(norm(text))

/** Two WhatsApp messages, like Instinct: a short line, then the link on its own so it renders as a preview card. */
export function inviteLinkReply(p: { code: string; remaining: number }): { text: string; link: string | null } {
  if (p.remaining <= 0) return { text: `You've used all ${INVITE_LIMIT} invites. Say "my invites" to see who joined.`, link: null }
  return { text: `You have ${p.remaining} invite${p.remaining === 1 ? '' : 's'} left. Your invite link is below; share it with a friend.`, link: inviteUrl(p.code) }
}

export type JoinedFriend = { name: string | null; phone: string; joinedAt: string }

export function myInvitesReply(p: { code: string; remaining: number; joined: JoinedFriend[]; tz?: string }): string {
  if (!p.joined.length) return `No one has joined with your invite yet. You have ${p.remaining} invite${p.remaining === 1 ? '' : 's'} left.\n\n${inviteUrl(p.code)}`
  const day = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: p.tz || 'Asia/Kolkata' }).format(new Date(iso))
  const lines = p.joined.map(f => `• ${firstName(f.name) || maskPhone(f.phone)}, joined ${day(f.joinedAt)}`)
  const used = p.joined.length
  return `${used} friend${used === 1 ? '' : 's'} joined with your invite. ${p.remaining} invite${p.remaining === 1 ? '' : 's'} left.\n\n${lines.join('\n')}${p.remaining > 0 ? `\n\nYour link: ${inviteUrl(p.code)}` : ''}`
}

export function inviterJoinedText(p: { friendName: string | null; friendPhone: string; remaining: number }): string {
  const who = firstName(p.friendName) || maskPhone(p.friendPhone)
  return `🎉 ${who} joined AskGogo with your invite. You have ${p.remaining} invite${p.remaining === 1 ? '' : 's'} left.`
}

export function inviteeWelcomeLine(inviterName: string | null): string {
  const who = firstName(inviterName)
  return who ? `🎉 You're in. ${who} invited you to AskGogo.` : `🎉 You're in. A friend invited you to AskGogo.`
}
