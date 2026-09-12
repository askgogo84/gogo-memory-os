import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshGmailAccessToken } from '@/lib/google-gmail'
import type { AgentActor } from './actor'

const MAX_MESSAGES = 8
const MAX_BYTES = 8 * 1024 * 1024

function clean(v: unknown, max = 4000) { return String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) }
function decode64(v: string) { return Buffer.from(String(v || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64') }
function header(headers: any[], name: string) { return String((headers || []).find((h: any) => String(h?.name || '').toLowerCase() === name.toLowerCase())?.value || '') }
function flatten(part: any, out: any[] = []) { if (!part) return out; out.push(part); for (const c of Array.isArray(part?.parts) ? part.parts : []) flatten(c, out); return out }

async function token(actor: AgentActor) {
  const { data, error } = await supabaseAdmin.from('users')
    .select('gmail_connected,gmail_access_token,gmail_refresh_token')
    .eq('telegram_id', actor.legacyTelegramId).maybeSingle()
  if (error) throw new Error(`gmail_ticket_credentials_failed:${error.message}`)
  if (!data?.gmail_connected) return null
  let access = String(data.gmail_access_token || '')
  if (!access && data.gmail_refresh_token) access = await refreshGmailAccessToken(String(data.gmail_refresh_token)) || ''
  if (!access) return null
  return { access, refreshToken: String(data.gmail_refresh_token || '') }
}

async function gmailFetch(actor: AgentActor, url: string) {
  const creds = await token(actor)
  if (!creds) return null
  let response = await fetch(url, { headers: { Authorization: `Bearer ${creds.access}` }, cache: 'no-store' })
  if (response.status === 401 && creds.refreshToken) {
    const next = await refreshGmailAccessToken(creds.refreshToken)
    if (!next) return null
    await supabaseAdmin.from('users').update({ gmail_access_token: next }).eq('telegram_id', actor.legacyTelegramId)
    response = await fetch(url, { headers: { Authorization: `Bearer ${next}` }, cache: 'no-store' })
  }
  if (!response.ok) return null
  return response
}

function textFromPart(part: any) {
  const mime = String(part?.mimeType || '').toLowerCase()
  const data = String(part?.body?.data || '')
  if (!data || !/^text\/(plain|html)/.test(mime)) return ''
  return decode64(data).toString('utf8').replace(/<[^>]+>/g, ' ')
}

async function bytesFor(actor: AgentActor, messageId: string, part: any) {
  const inline = String(part?.body?.data || '')
  if (inline) {
    const b = decode64(inline); return b.length <= MAX_BYTES ? b : null
  }
  const id = String(part?.body?.attachmentId || '')
  if (!id) return null
  const r = await gmailFetch(actor, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(id)}`)
  if (!r) return null
  const data: any = await r.json().catch(() => ({}))
  const b = decode64(String(data?.data || ''))
  return b.length <= MAX_BYTES ? b : null
}

function scoreCredential(params: { mime: string; filename: string; body: string; subject: string }) {
  const hay = `${params.filename} ${params.subject} ${params.body}`.toLowerCase()
  let score = 0
  if (/qr|qrcode|barcode/.test(hay)) score += 12
  if (/boarding pass|movie ticket|e-?ticket|entry pass|show ticket|your ticket|booking confirmation/.test(hay)) score += 8
  if (/scan (?:this|at)|present this|entry/.test(hay)) score += 5
  if (/ticket|pass|qr|barcode/.test(params.filename.toLowerCase())) score += 8
  if (params.mime === 'application/pdf') score += 4
  if (params.mime.startsWith('image/')) score += 3
  return score
}

export type GmailTicketEvidence = {
  messageId: string
  threadId: string
  subject: string
  from: string
  bodyText: string
  credential?: { bytes: Buffer; mimeType: string; filename: string; source: 'gmail' }
}

export async function findGmailTicketEvidence(actor: AgentActor, queryText: string): Promise<GmailTicketEvidence | null> {
  const creds = await token(actor)
  if (!creds) return null
  const terms = clean(queryText, 500).replace(/https?:\/\/\S+/g, ' ').split(/[^A-Za-z0-9]+/).filter(x => x.length > 2).slice(0, 8)
  const q = [...terms, 'newer_than:1y'].join(' ')
  const list = await gmailFetch(actor, `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: String(MAX_MESSAGES) })}`)
  if (!list) return null
  const data: any = await list.json().catch(() => ({}))
  const ids = (Array.isArray(data?.messages) ? data.messages : []).map((x: any) => String(x?.id || '')).filter(Boolean).slice(0, MAX_MESSAGES)

  let best: { evidence: GmailTicketEvidence; score: number } | null = null
  for (const id of ids) {
    const r = await gmailFetch(actor, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`)
    if (!r) continue
    const msg: any = await r.json().catch(() => ({}))
    const parts = flatten(msg?.payload)
    const subject = clean(header(msg?.payload?.headers || [], 'Subject'), 240)
    const from = clean(header(msg?.payload?.headers || [], 'From'), 240)
    const bodyText = clean(parts.map(textFromPart).filter(Boolean).join('\n'), 12000)
    let candidate: GmailTicketEvidence['credential'] | undefined
    let candidateScore = 0
    for (const part of parts) {
      const mime = String(part?.mimeType || '').toLowerCase()
      if (!(mime.startsWith('image/') || mime === 'application/pdf')) continue
      const filename = clean(part?.filename || '', 240)
      const score = scoreCredential({ mime, filename, body: bodyText, subject })
      if (score < 8 || score <= candidateScore) continue
      const bytes = await bytesFor(actor, id, part)
      if (!bytes?.length) continue
      candidate = { bytes, mimeType: mime || 'application/octet-stream', filename: filename || (mime === 'application/pdf' ? 'ticket.pdf' : 'ticket.png'), source: 'gmail' }
      candidateScore = score
    }
    const messageScore = scoreCredential({ mime: '', filename: '', body: bodyText, subject })
    const evidence: GmailTicketEvidence = { messageId: id, threadId: String(msg?.threadId || ''), subject, from, bodyText, credential: candidate }
    const total = messageScore + candidateScore
    if (!best || total > best.score) best = { evidence, score: total }
  }
  return best && best.score >= 8 ? best.evidence : null
}
