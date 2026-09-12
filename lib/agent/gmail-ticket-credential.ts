import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshGmailAccessToken } from '@/lib/google-gmail'
import type { AgentActor } from './actor'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
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

function filenameEvidence(filename: string) {
  return /\b(ticket|e-?ticket|boarding|pass|qr|qrcode|barcode|entry|voucher)\b/i.test(String(filename || '').replace(/[_-]+/g, ' '))
}

async function verifyImageCredential(bytes: Buffer, mimeType: string) {
  if (!bytes.length || bytes.length > MAX_BYTES) return false
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(mimeType)) return false
  try {
    const r = await anthropic.messages.create({
      model: 'claude-haiku-4-5', max_tokens: 20, temperature: 0,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType as any, data: bytes.toString('base64') } },
        { type: 'text', text: 'Is this image itself a usable event/movie/concert entry credential, QR code, barcode, e-ticket, or ticket/pass that a venue could scan or inspect? Reply exactly TICKET_CREDENTIAL or OTHER. Logos, posters, banners and marketing images are OTHER.' },
      ] }],
    })
    const answer = r.content[0]?.type === 'text' ? r.content[0].text.trim().toUpperCase() : ''
    return answer === 'TICKET_CREDENTIAL'
  } catch { return false }
}

function messageEvidence(body: string, subject: string) {
  const hay = `${subject} ${body}`.toLowerCase()
  let score = 0
  if (/\b(boarding pass|movie ticket|e-?ticket|entry pass|show ticket|your ticket|booking confirmation)\b/.test(hay)) score += 5
  if (/\b(scan (?:this|at)|present this|entry)\b/.test(hay)) score += 3
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
    const msgScore = messageEvidence(bodyText, subject)
    let candidate: GmailTicketEvidence['credential'] | undefined
    let candidateScore = 0

    for (const part of parts) {
      const mime = String(part?.mimeType || '').toLowerCase()
      if (!(mime.startsWith('image/') || mime === 'application/pdf')) continue
      const filename = clean(part?.filename || '', 240)
      const bytes = await bytesFor(actor, id, part)
      if (!bytes?.length) continue

      if (mime.startsWith('image/')) {
        // Message-level words like "booking confirmation" are NOT attachment-local
        // evidence: an airline/provider logo sees those words too. Verify pixels.
        const imageIsCredential = await verifyImageCredential(bytes, mime)
        if (!imageIsCredential) continue
        const score = 20 + (filenameEvidence(filename) ? 4 : 0) + msgScore
        if (score > candidateScore) {
          candidate = { bytes, mimeType: mime, filename: filename || 'ticket-qr.png', source: 'gmail' }
          candidateScore = score
        }
        continue
      }

      // PDFs need ticket-shaped attachment-local evidence as well. This prevents a
      // generic brochure/invoice attached to a confirmation email becoming the pass.
      if (mime === 'application/pdf' && filenameEvidence(filename) && msgScore >= 3) {
        const score = 14 + msgScore
        if (score > candidateScore) {
          candidate = { bytes, mimeType: mime, filename: filename || 'ticket.pdf', source: 'gmail' }
          candidateScore = score
        }
      }
    }

    const evidence: GmailTicketEvidence = { messageId: id, threadId: String(msg?.threadId || ''), subject, from, bodyText, credential: candidate }
    const total = msgScore + candidateScore
    if (!best || total > best.score) best = { evidence, score: total }
  }
  return best && best.score >= 5 ? best.evidence : null
}
