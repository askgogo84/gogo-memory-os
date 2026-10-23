// Email attention: reads the person's mail from whatever they connected (Gmail, forwarded inbox, Composio),
// picks what needs them, records what was shown, and learns from "not important" / "important" / draft / remind.
// Read-only toward the mailbox. Drafting goes through the existing approval-gated Gmail send path.
import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from '@/lib/agent/actor'
import { decryptGoogleToken } from '@/lib/security/google-token-crypto'
import { fetchGmailAttentionThreads, refreshGmailAccessToken } from '@/lib/services/google-gmail'
import {
  type AttentionEmail, type AttentionRule, type ScoredEmail, type AttentionPick,
  pickAttention, formatAttentionCard, ruleFromFeedback, scoreEmail, senderEmailOf, senderDomainOf, senderNameOf,
} from './attention'
import { parseAttentionCommand, isUndo, type AttentionCommand } from './attention-commands'

type Result = { runId: string; status: 'completed' | 'failed'; capability: 'orchestrator'; risk: 'low'; text: string; handledBy: string }
const ok = (text: string, runId = 'email-attention'): Result => ({ runId, status: 'completed', capability: 'orchestrator', risk: 'low', text, handledBy: 'email-attention' })

function clean(value: unknown, max = 600) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

// ---------- rules and events ----------

export async function loadRules(telegramId: number): Promise<AttentionRule[]> {
  const { data, error } = await supabaseAdmin.from('email_attention_rules')
    .select('id,kind,match_type,match_value,category,label,source').eq('telegram_id', telegramId).eq('active', true).limit(300)
  if (error) { console.error('EMAIL_RULES_READ_FAILED:', error.message); return [] }
  return (data || []).map((r: any) => ({ id: r.id, kind: r.kind, matchType: r.match_type, matchValue: r.match_value, category: r.category, label: r.label, source: r.source }))
}

export async function saveRule(telegramId: number, rule: AttentionRule): Promise<string | null> {
  let q = supabaseAdmin.from('email_attention_rules').select('id').eq('telegram_id', telegramId)
    .eq('match_type', rule.matchType).eq('match_value', rule.matchValue.toLowerCase())
  q = rule.category ? q.eq('category', rule.category) : q.is('category', null)
  const { data: existing } = await q.limit(1)
  const row = { kind: rule.kind, label: rule.label, source: rule.source, active: true, updated_at: new Date().toISOString() }
  if (existing?.[0]?.id) {
    const { error } = await supabaseAdmin.from('email_attention_rules').update(row).eq('id', existing[0].id).eq('telegram_id', telegramId)
    if (error) throw new Error(`email_rule_update_failed:${error.message}`)
    return existing[0].id
  }
  const { data, error } = await supabaseAdmin.from('email_attention_rules').insert({
    telegram_id: telegramId, match_type: rule.matchType, match_value: rule.matchValue.toLowerCase(), category: rule.category || null, ...row,
  }).select('id').maybeSingle()
  if (error) throw new Error(`email_rule_insert_failed:${error.message}`)
  return data?.id || null
}

async function recordEvent(telegramId: number, kind: string, payload: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('email_attention_events').insert({ telegram_id: telegramId, kind, payload })
  if (error) console.error('EMAIL_ATTENTION_EVENT_FAILED:', error.message)
}

type ShownItem = {
  index: number; id: string; threadId: string | null; messageId: string | null; from: string; subject: string; snippet: string
  category: string; senderEmail: string; senderName: string; why: string; ask: string; source: string; score: number
}

async function lastShown(telegramId: number): Promise<ShownItem[] | null> {
  const since = new Date(Date.now() - 24 * 3600_000).toISOString()
  const { data } = await supabaseAdmin.from('email_attention_events').select('payload,created_at')
    .eq('telegram_id', telegramId).eq('kind', 'shown').gte('created_at', since).order('created_at', { ascending: false }).limit(1)
  const items = (data?.[0] as any)?.payload?.items
  return Array.isArray(items) && items.length ? items as ShownItem[] : null
}

async function lastAssistantReply(telegramId: number): Promise<{ content: string; at: number } | null> {
  const { data } = await supabaseAdmin.from('conversations').select('content,created_at')
    .eq('telegram_id', telegramId).eq('role', 'assistant').order('created_at', { ascending: false }).limit(1)
  const row = (data || [])[0] as any
  return row ? { content: String(row.content || ''), at: Date.parse(String(row.created_at || '')) || 0 } : null
}

// ---------- sources ----------

export type AttentionRead = {
  connected: boolean
  emails: AttentionEmail[]
  ownEmail: string | null
  repliedSenders: Set<string>
  sources: string[]
  gmailEmail: string | null
}

async function gmailToken(telegramId: number) {
  const [{ data: user }, { data: consent }] = await Promise.all([
    supabaseAdmin.from('users').select('gmail_connected,gmail_email,gmail_access_token,gmail_refresh_token').eq('telegram_id', telegramId).maybeSingle(),
    supabaseAdmin.from('user_consent_settings').select('gmail_enabled').eq('telegram_id', telegramId).maybeSingle(),
  ])
  if (consent?.gmail_enabled === false || !user?.gmail_connected) return null
  let token = ''
  const refresh = decryptGoogleToken(user.gmail_refresh_token)
  if (refresh) token = String(await refreshGmailAccessToken(refresh) || '')
  if (!token) token = decryptGoogleToken(user.gmail_access_token)
  return token ? { token, email: String(user.gmail_email || '').toLowerCase() || null } : null
}

async function readGmail(telegramId: number) {
  const access = await gmailToken(telegramId)
  if (!access) return null
  const threads = await fetchGmailAttentionThreads(access.token, 20)
  const own = access.email
  const replied = new Set<string>()
  const emails: AttentionEmail[] = []
  for (const thread of threads) {
    const msgs = thread.messages || []
    // A thread where the person has written is a conversation they care about: remember who they write to.
    for (const m of msgs) if (own && senderEmailOf(m.from) === own) for (const addr of String(m.to || '').match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || []) replied.add(addr.toLowerCase())
    const last = msgs[msgs.length - 1]
    if (last) emails.push({ ...last, threadId: thread.id, source: 'gmail' })
  }
  return { emails, own, replied }
}

async function readForwarded(telegramId: number) {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString()
  const { data, error } = await supabaseAdmin.from('inbound_emails')
    .select('id,message_id,thread_key,from_addr,to_addr,subject,snippet,list_id,list_unsubscribe,auto_submitted,received_at')
    .eq('telegram_id', telegramId).gte('received_at', since).order('received_at', { ascending: false }).limit(60)
  if (error) { console.error('INBOUND_EMAIL_READ_FAILED:', error.message); return null }
  const { data: alias } = await supabaseAdmin.from('email_aliases').select('alias').eq('telegram_id', telegramId).maybeSingle()
  if (!alias) return null
  return (data || []).map((r: any): AttentionEmail => ({
    id: String(r.id), threadId: r.thread_key || r.message_id, messageId: r.message_id, from: r.from_addr, to: r.to_addr, subject: r.subject,
    snippet: r.snippet, internalDate: Date.parse(r.received_at), listId: r.list_id, listUnsubscribe: r.list_unsubscribe, autoSubmitted: r.auto_submitted, source: 'forwarded',
  }))
}

async function readComposio(telegramId: number) {
  const mod: any = await import('@/lib/connectors/composio-gmail').catch(() => null)
  if (!mod?.fetchComposioRecentEmails) return null
  return await mod.fetchComposioRecentEmails(telegramId).catch((err: any) => { console.error('COMPOSIO_GMAIL_READ_FAILED:', String(err?.message || err).slice(0, 160)); return null })
}

export async function readAttentionSources(telegramId: number): Promise<AttentionRead> {
  const [gmail, forwarded] = await Promise.all([
    readGmail(telegramId).catch((err: any) => { console.error('ATTENTION_GMAIL_READ_FAILED:', String(err?.message || err).slice(0, 160)); return null }),
    readForwarded(telegramId),
  ])
  const composio = gmail ? null : await readComposio(telegramId)
  const emails: AttentionEmail[] = []
  const seen = new Set<string>()
  const add = (list: AttentionEmail[] | null | undefined) => {
    for (const e of list || []) {
      const key = clean(e.messageId, 300).toLowerCase() || `${senderEmailOf(e.from)}|${clean(e.subject, 120).toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key); emails.push(e)
    }
  }
  add(gmail?.emails); add(composio?.emails); add(forwarded)
  const sources = [gmail && 'gmail', composio && 'composio', forwarded && 'forwarded'].filter(Boolean) as string[]
  return {
    connected: sources.length > 0, emails, sources,
    ownEmail: gmail?.own || composio?.ownEmail || null,
    repliedSenders: new Set([...(gmail?.replied || []), ...(composio?.repliedSenders || [])]),
    gmailEmail: gmail?.own || null,
  }
}

// ---------- one-line asks ----------

type Polisher = (prompt: string) => Promise<string>
const defaultPolisher: Polisher = async prompt => {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key || key === 'x') throw new Error('no_model')
  const client = new Anthropic({ apiKey: key })
  const res = await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 300, temperature: 0, messages: [{ role: 'user', content: prompt }] }, { timeout: 3500 })
  return (res.content.find((b: any) => b.type === 'text') as any)?.text || ''
}

/** Rewrites each picked person email into one plain line saying what it asks. Falls back to the extracted sentence. */
export async function polishAsks(picked: ScoredEmail[], polish: Polisher = defaultPolisher) {
  const targets = picked.filter(s => s.category === 'person')
  if (!targets.length) return picked
  const prompt = `For each email, write ONE line (max 14 words) saying what it asks of the reader, e.g. "Needs your sign-off on the Q4 vendor contract before Friday." No names, no greetings, no quotes. Reply as numbered lines only.\n\n${targets.map((s, i) => `${i + 1}. Subject: ${clean(s.email.subject, 160)}\nText: ${clean(s.email.snippet, 400)}`).join('\n\n')}`
  try {
    const out = await polish(prompt)
    const lines = out.split('\n').map(l => l.match(/^\s*(\d+)[.)]\s*(.+)$/)).filter(Boolean) as RegExpMatchArray[]
    for (const m of lines) {
      const s = targets[Number(m[1]) - 1]
      const line = m[2].trim().replace(/^["']|["']$/g, '')
      if (s && line.length >= 8 && line.length <= 140) s.ask = line
    }
  } catch {}
  return picked
}

// ---------- the card ----------

export async function buildAttentionCard(actor: Pick<AgentActor, 'legacyTelegramId' | 'timezone'>, opts: { polish?: Polisher | null } = {}) {
  const telegramId = Number(actor.legacyTelegramId)
  const [read, rules] = await Promise.all([readAttentionSources(telegramId), loadRules(telegramId)])
  if (!read.connected) return { connected: false as const, text: `📬 Connect your email first and I'll tell you only what needs you.\n\nOpen https://app.askgogo.in/dashboard/settings/email to forward your mail or sign in with Google.`, pick: null }
  const pick: AttentionPick = pickAttention(read.emails, { rules, ownEmail: read.ownEmail, repliedSenders: read.repliedSenders })
  if (opts.polish !== null) await polishAsks(pick.picked, opts.polish || defaultPolisher)
  const text = formatAttentionCard(pick, { timezone: actor.timezone || 'Asia/Kolkata' })
  await recordEvent(telegramId, 'shown', {
    sources: read.sources, checked: pick.checked,
    items: pick.picked.map((s, i): ShownItem => ({
      index: i + 1, id: s.email.id, threadId: s.email.threadId || null, messageId: s.email.messageId || null, from: s.email.from,
      subject: clean(s.email.subject, 200), snippet: clean(s.email.snippet, 500), category: s.category, senderEmail: s.senderEmail,
      senderName: s.senderName, why: s.why, ask: s.ask, source: s.email.source || 'gmail', score: s.score,
    })),
    gmailEmail: read.ownEmail,
  })
  return { connected: true as const, text, pick }
}

// ---------- commands ----------

function itemAsScored(item: ShownItem) {
  return { category: item.category as any, senderEmail: item.senderEmail, senderName: item.senderName, email: { from: item.from } }
}

async function learnFromBehaviour(telegramId: number, item: ShownItem) {
  // Drafting or setting a reminder for the same sender twice in 60 days means their mail matters.
  const since = new Date(Date.now() - 60 * 86400_000).toISOString()
  const { data } = await supabaseAdmin.from('email_attention_events').select('payload')
    .eq('telegram_id', telegramId).in('kind', ['draft', 'remind', 'important']).gte('created_at', since).limit(200)
  const domain = senderDomainOf(item.from)
  const key = item.category === 'person' ? item.senderEmail : domain
  const count = (data || []).filter((r: any) => (r.payload?.senderKey || '') === key).length
  if (count < 2 || !key) return
  const rules = await loadRules(telegramId)
  if (rules.some(r => r.matchValue === key)) return
  const rule = ruleFromFeedback(itemAsScored(item), 'always')
  await saveRule(telegramId, { ...rule, source: 'behaviour' }).catch(() => null)
}

function gmailLink(item: ShownItem, gmailEmail: string | null) {
  const ref = String(item.threadId || '')
  return (item.source === 'gmail' || item.source === 'composio') && /^[a-f0-9]{6,64}$/i.test(ref) ? `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(gmailEmail || '')}#all/${ref}` : null
}

async function draftBody(item: ShownItem, polish: Polisher = defaultPolisher) {
  const prompt = `Write a short, polite email reply (2-4 sentences) to this email. No greeting line, no sign-off, no placeholders in brackets. If a decision is needed, say the reader will confirm shortly rather than inventing a decision.\n\nFrom: ${item.senderName}\nSubject: ${item.subject}\nText: ${item.snippet}`
  try {
    const out = (await polish(prompt)).trim()
    if (out.length >= 20 && out.length <= 1200 && !/\[[^\]]+\]/.test(out)) return out
  } catch {}
  return `Thanks for your email about ${item.subject.replace(/^(?:re|fwd?):\s*/i, '')}. I'll look into this and get back to you shortly.`
}

export type AttentionCommandResult = Result | { rewrite: string }

export async function handleEmailAttentionCommand(params: { actor: AgentActor; text: string; polish?: Polisher }): Promise<AttentionCommandResult | null> {
  const cmd: AttentionCommand | null = parseAttentionCommand(params.text) || (isUndo(params.text) ? { type: 'undo' } : null)
  if (!cmd) return null
  const telegramId = Number(params.actor.legacyTelegramId)

  if (cmd.type === 'show') {
    try { return ok((await buildAttentionCard(params.actor, { polish: params.polish })).text, 'email-attention-show') }
    catch (err: any) { console.error('EMAIL_ATTENTION_SHOW_FAILED:', String(err?.message || err).slice(0, 160)); return { ...ok(`📬 I couldn't read your email just now. I didn't guess. Please try again in a minute.`), status: 'failed' } }
  }

  if (cmd.type === 'rules') {
    const rules = await loadRules(telegramId)
    const always = rules.filter(r => r.kind === 'always'), never = rules.filter(r => r.kind === 'never')
    const src = (r: AttentionRule) => r.source === 'behaviour' ? 'you act on these' : r.source === 'chat' ? 'you told me' : 'you marked it'
    const lines = ['📬 What I flag for you', '', 'Always']
    lines.push('• Anyone asking you to decide, approve or reply', '• Bills and payments due soon', '• Security alerts and service cut-off notices')
    always.forEach(r => lines.push(`• ${r.label.charAt(0).toUpperCase()}${r.label.slice(1)} (${src(r)})`))
    lines.push('', 'Never')
    lines.push('• Codes, bank debit alerts, promotions and newsletters')
    never.forEach(r => lines.push(`• ${r.label.charAt(0).toUpperCase()}${r.label.slice(1)} (${src(r)})`))
    lines.push('', `Say "always flag mail from Nithin" or "remove rule for Swiggy".`)
    return ok(lines.join('\n'), 'email-attention-rules')
  }

  if (cmd.type === 'rule_text') {
    const target = cmd.target.replace(/^(?:my|the)\s+/i, '')
    let rule: AttentionRule
    if (/@/.test(target)) rule = { kind: cmd.kind, matchType: 'sender', matchValue: target.toLowerCase(), label: `mail from ${target}`, source: 'chat' }
    else if (/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(target)) rule = { kind: cmd.kind, matchType: 'domain', matchValue: target.toLowerCase(), label: `mail from ${target}`, source: 'chat' }
    else {
      // Resolve a name ("Nithin", "Swiggy") against recent senders so the rule matches real addresses.
      const read = await readAttentionSources(telegramId).catch(() => null)
      const hit = read?.emails.find(e => senderNameOf(e.from).toLowerCase().includes(target.toLowerCase()) || senderEmailOf(e.from).includes(target.toLowerCase()))
      if (hit) {
        const scored = scoreEmail(hit)
        rule = { ...ruleFromFeedback(scored, cmd.kind), source: 'chat' }
        if (rule.matchType === 'sender_category') rule = { kind: cmd.kind, matchType: 'domain', matchValue: senderDomainOf(hit.from), label: `mail from ${scored.senderName}`, source: 'chat' }
      } else rule = { kind: cmd.kind, matchType: 'sender', matchValue: target.toLowerCase(), label: `mail from ${target}`, source: 'chat' }
    }
    await saveRule(telegramId, rule)
    return ok(cmd.kind === 'always' ? `📬 Done. I'll always flag ${rule.label}.` : `📬 Done. I won't flag ${rule.label} again.`, 'email-attention-rule')
  }

  if (cmd.type === 'remove_rule') {
    const rules = await loadRules(telegramId)
    const t = cmd.target.toLowerCase()
    const hits = rules.filter(r => r.label.toLowerCase().includes(t) || r.matchValue.includes(t))
    if (!hits.length) return ok(`📬 I don't have an email rule for ${cmd.target}. Say "what do you flag" to see them.`)
    await supabaseAdmin.from('email_attention_rules').update({ active: false, updated_at: new Date().toISOString() }).in('id', hits.map(h => h.id!)).eq('telegram_id', telegramId)
    return ok(`📬 Removed: ${hits.map(h => h.label).join(', ')}.`, 'email-attention-rule')
  }

  // Numbered actions and "undo" bind only to Gogo's latest reply being an email-attention reply.
  const last = await lastAssistantReply(telegramId)
  if (!last || !last.content.startsWith('📬') || Date.now() - last.at > 6 * 3600_000) return null

  if (cmd.type === 'undo') {
    const since = new Date(Date.now() - 30 * 60_000).toISOString()
    const { data } = await supabaseAdmin.from('email_attention_events').select('payload,kind')
      .eq('telegram_id', telegramId).in('kind', ['not_important', 'important']).gte('created_at', since).order('created_at', { ascending: false }).limit(1)
    const ev = (data || [])[0] as any
    if (!ev?.payload?.ruleId) return ok(`📬 There's nothing recent to undo.`)
    await supabaseAdmin.from('email_attention_rules').update({ active: false, updated_at: new Date().toISOString() }).eq('id', ev.payload.ruleId).eq('telegram_id', telegramId)
    await recordEvent(telegramId, 'undo', { ruleId: ev.payload.ruleId })
    return ok(`📬 Undone. I'm back to my usual judgement for ${ev.payload.label || 'that sender'}.`, 'email-attention-undo')
  }

  const items = await lastShown(telegramId)
  const item = items?.find(i => i.index === cmd.index)
  if (!item) return ok(`📬 I don't see email ${cmd.index} in the list I just showed. Say "emails that need me" for a fresh list.`)
  const senderKey = item.category === 'person' ? item.senderEmail : senderDomainOf(item.from)

  if (cmd.type === 'not_important' || cmd.type === 'important') {
    const kind = cmd.type === 'important' ? 'always' : 'never'
    const rule = ruleFromFeedback(itemAsScored(item), kind)
    const ruleId = await saveRule(telegramId, rule)
    await recordEvent(telegramId, cmd.type, { index: item.index, senderKey, ruleId, label: rule.label, category: item.category })
    if (kind === 'always') { await learnFromBehaviour(telegramId, item).catch(() => {}); return ok(`📬 Noted. I'll always flag ${rule.label}.\nSay "undo" to take it back.`, 'email-attention-feedback') }
    const keepNote = item.category === 'person' ? '' : ` Refunds or problems from ${item.senderName} will still come through.`
    return ok(`📬 Got it. I won't flag ${rule.label} again.${keepNote}\nSay "undo" to take it back.`, 'email-attention-feedback')
  }

  if (cmd.type === 'why') {
    const rules = await loadRules(telegramId)
    const rule = rules.find(r => r.matchValue === senderKey)
    const ruleLine = rule ? `\nYour rule: ${rule.kind === 'always' ? 'always flag' : 'never flag'} ${rule.label}.` : ''
    return ok(`📬 Why I picked ${item.index}: ${item.why}.\nFrom ${item.senderName}: "${item.subject}".${ruleLine}\nSay "not important ${item.index}" if it wasn't worth it.`, 'email-attention-why')
  }

  if (cmd.type === 'open') {
    await recordEvent(telegramId, 'open', { index: item.index, senderKey })
    const ev = await supabaseAdmin.from('email_attention_events').select('payload').eq('telegram_id', telegramId).eq('kind', 'shown').order('created_at', { ascending: false }).limit(1)
    const link = gmailLink(item, (ev.data?.[0] as any)?.payload?.gmailEmail || null)
    return ok(`📬 ${item.senderName}: ${item.subject}\n\n${item.snippet}${link ? `\n\nOpen in Gmail: ${link}` : ''}`, 'email-attention-open')
  }

  if (cmd.type === 'remind') {
    await recordEvent(telegramId, 'remind', { index: item.index, senderKey })
    await learnFromBehaviour(telegramId, item).catch(() => {})
    const what = item.category === 'bill_due' ? `pay the ${item.senderName} bill` : item.category === 'person' ? `reply to ${item.senderName} about ${item.subject.replace(/^(?:re|fwd?):\s*/i, '')}` : `check the ${item.senderName} email: ${item.subject}`
    return { rewrite: `remind me ${cmd.when || 'tomorrow at 10am'} to ${what}` }
  }

  // draft
  await recordEvent(telegramId, 'draft', { index: item.index, senderKey })
  await learnFromBehaviour(telegramId, item).catch(() => {})
  if (item.category !== 'person') return ok(`📬 ${item.senderName} is an automated sender, so there's no one to reply to. Say "remind ${item.index}" and I'll remind you to act on it.`)
  const body = await draftBody(item, params.polish)
  if (item.source === 'gmail') return { rewrite: `draft a reply to the email from ${item.senderEmail || item.senderName} saying ${body}` }
  return ok(`📬 Here's a reply to ${item.senderName} you can paste:\n\n${body}\n\nI can send replies myself once you sign in with Google in Settings › Email.`, 'email-attention-draft')
}
