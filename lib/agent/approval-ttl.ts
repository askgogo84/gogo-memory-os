// Approval-card lifetime and disambiguation (Muse Sentinel / Wajo semantics).
// Pure helpers only: no DB, no network. approval-binding.ts stays the exact-action hash contract;
// this file decides whether a pending approval is still live and which one a reply refers to.

/** Default lifetime of a pending approval card. A per-action expires_at (row or payload) overrides it. */
export const APPROVAL_TTL_HOURS = 24

/** Most approvals ever listed for a numbered "approve 2" reply. */
export const APPROVAL_LIST_LIMIT = 5

export type ApprovalTtlRow = {
  requested_at?: string | null
  expires_at?: string | null
  execution_payload?: unknown
}

function validTime(value: unknown): number | null {
  if (value == null || value === '') return null
  const ms = new Date(String(value)).getTime()
  return Number.isFinite(ms) ? ms : null
}

/** Explicit per-action expiry, if the row or its execution payload carries one. */
export function approvalExplicitExpiry(row: ApprovalTtlRow): number | null {
  const payload = row?.execution_payload && typeof row.execution_payload === 'object' ? row.execution_payload as Record<string, unknown> : null
  return validTime(row?.expires_at) ?? validTime(payload?.expires_at) ?? validTime(payload?.expiresAt)
}

/**
 * True when the approval may no longer be acted on. Fails closed: a row with neither a usable
 * expires_at nor a usable requested_at cannot be proven fresh, so it is treated as expired.
 */
export function isApprovalExpired(row: ApprovalTtlRow, now: Date | number = Date.now(), ttlHours: number = APPROVAL_TTL_HOURS): boolean {
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const explicit = approvalExplicitExpiry(row)
  if (explicit != null) return nowMs >= explicit
  const requested = validTime(row?.requested_at)
  if (requested == null) return true
  const hours = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : APPROVAL_TTL_HOURS
  return nowMs >= requested + hours * 3_600_000
}

/** "just now", "5 minutes ago", "26 hours ago", "3 days ago". */
export function approvalRelativeAge(requestedAt: string | null | undefined, now: Date | number = Date.now()): string {
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const at = validTime(requestedAt)
  if (at == null) return 'at an unknown time'
  const minutes = Math.max(0, Math.floor((nowMs - at) / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} days ago`
}

export function expiredApprovalReply(requestedAt: string | null | undefined, now: Date | number = Date.now()): string {
  return `That approval expired (requested ${approvalRelativeAge(requestedAt, now)}). Nothing was done. Ask me again and I'll prepare a fresh request.`
}

/**
 * Splits pending rows into expired and live, and returns the live ones in the one deterministic
 * order used both for the numbered list and for "approve N": oldest first, limited to the most
 * recent APPROVAL_LIST_LIMIT live approvals. Ties on requested_at break on id.
 */
export function partitionPendingApprovals<T extends ApprovalTtlRow & { id?: unknown }>(rows: T[], now: Date | number = Date.now(), ttlHours: number = APPROVAL_TTL_HOURS) {
  const expired: T[] = []
  const live: T[] = []
  for (const row of rows || []) (isApprovalExpired(row, now, ttlHours) ? expired : live).push(row)
  const time = (row: T) => validTime(row.requested_at) ?? 0
  const ascending = (a: T, b: T) => time(a) - time(b) || String(a.id ?? '').localeCompare(String(b.id ?? ''))
  live.sort(ascending)
  expired.sort(ascending)
  const listed = live.slice(-APPROVAL_LIST_LIMIT)
  return { expired, live: listed, liveTotal: live.length }
}

/**
 * Several cards can share a generic title ("Block calendar for this booking"), so each
 * numbered line also shows what it acts on from the card's own preview (event, date,
 * place), never from execution internals. 19 Oct live: two identical lines.
 */
export function approvalDetail(row: { payload_preview?: unknown }): string {
  const preview = Array.isArray(row.payload_preview) ? row.payload_preview as Array<{ label?: unknown; value?: unknown }> : []
  const pick = (re: RegExp) => preview.find(item => re.test(String(item?.label || '')))?.value
  const parts = [pick(/^(?:event|title|item|subject|restaurant|flight|reminder)$/i), pick(/^(?:starts?|date|when|time|new time)$/i), pick(/^(?:venue|place|location|to)$/i)]
    .map(value => String(value ?? '').replace(/\s+/g, ' ').trim()).filter(value => value && !/^not provided$/i.test(value))
  return parts.join(' · ').slice(0, 160)
}

export function approvalChoiceList(rows: Array<{ title?: string | null; requested_at?: string | null; payload_preview?: unknown }>, now: Date | number = Date.now()): string {
  return rows.map((row, i) => {
    const detail = approvalDetail(row)
    return `${i + 1}. ${String(row.title || 'Pending action').slice(0, 140)}${detail ? ` — ${detail}` : ''} (requested ${approvalRelativeAge(row.requested_at, now)})`
  }).join('\n')
}

export type ApprovalTurn = { role: string; content: string; created_at: string }

/** How long Gogo's own "Reply APPROVE" ask stays the thing a bare APPROVE answers. */
export const APPROVAL_ASK_MAX_AGE_MS = 30 * 60_000

const normalizeTurnText = (value: unknown) => String(value || '').replace(/\s+/g, ' ').trim().toLowerCase()

/** "Approve timed reservation attempt · Toit Indiranagar" -> "Toit Indiranagar"; otherwise the title. */
export function approvalSubject(row: { title?: string | null }): string {
  const title = String(row?.title || '').trim()
  const tail = title.split('·').pop()?.trim()
  return (tail || title).slice(0, 140)
}

/**
 * 19 Oct live: "Ready to book 7pm tomorrow … Reply APPROVE" was answered "Approve", and an unrelated
 * 27-hour-old card stole the reply. When Gogo's latest assistant turn was a specific bare
 * "Reply APPROVE" ask (recent, nothing else said since), a bare APPROVE means the live approval
 * that ask was about: the one requested in the minutes around that turn, or, if several were, the
 * one whose subject the ask names. Anything ambiguous returns null and the caller lists choices.
 */
export function approvalAskedInLatestTurn<T extends ApprovalTtlRow & { id?: unknown; title?: string | null }>(live: T[], turns: ApprovalTurn[] | null | undefined, currentText: string, now: Date | number = Date.now()): T | null {
  if (!Array.isArray(turns) || !turns.length || !live.length) return null
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const latest = turns.find((t) => t?.role === 'assistant')
  if (!latest) return null
  const content = String(latest.content || '')
  // A bare ask only: "Reply approve 1 or reject 2" is a numbered list, not a specific ask.
  if (!/\breply\s+\*?approve\b\*?(?!\s*#?\s*\d)/i.test(content)) return null
  const at = validTime(latest.created_at)
  if (at == null || nowMs - at > APPROVAL_ASK_MAX_AGE_MS || at - nowMs > 60_000) return null
  const current = normalizeTurnText(currentText)
  if (turns.some((t) => t?.role === 'user' && (validTime(t.created_at) ?? 0) > at && normalizeTurnText(t.content) !== current)) return null
  const near = live.filter((row) => {
    const requested = validTime(row.requested_at)
    return requested != null && requested <= at + 60_000 && requested >= at - 10 * 60_000
  })
  if (near.length === 1) return near[0]
  const lower = content.toLowerCase()
  const named = near.filter((row) => {
    const subject = approvalSubject(row).toLowerCase()
    return subject.length >= 3 && lower.includes(subject)
  })
  return named.length === 1 ? named[0] : null
}

/**
 * The approval a bare APPROVE / REJECT binds to, or null when the person must pick from a list.
 * Expired rows are never candidates (the caller closes them silently). One live card binds when it
 * is the newest card of all, so an older expired card can never block it; a newer expired card
 * might be what the person meant, so that case still asks. Gogo's own latest specific ask wins.
 */
export function bareApprovalTarget<T extends ApprovalTtlRow & { id?: unknown; title?: string | null }>(p: { expired: T[]; live: T[]; turns?: ApprovalTurn[] | null; currentText: string; now?: Date | number }): T | null {
  const now = p.now ?? Date.now()
  const asked = approvalAskedInLatestTurn(p.live, p.turns, p.currentText, now)
  if (asked) return asked
  if (p.live.length !== 1) return null
  const only = p.live[0]
  const onlyAt = validTime(only.requested_at) ?? 0
  return p.expired.every((row) => (validTime(row.requested_at) ?? 0) < onlyAt) ? only : null
}

/** A bare number ("1") right after a numbered approval list: the list must be Gogo's latest turn. */
export function isBareApprovalNumber(text: string): number | null {
  const m = String(text || '').trim().replace(/^["'“”‘’`]+|["'“”‘’`.!]+$/g, '').match(/^#?\s*(\d{1,2})$/)
  return m ? Number(m[1]) : null
}

export function latestTurnIsApprovalList(turns: ApprovalTurn[] | null | undefined, currentText: string, now: Date | number = Date.now()): boolean {
  if (!Array.isArray(turns) || !turns.length) return false
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const latest = turns.find((t) => t?.role === 'assistant')
  if (!latest || !/\breply\s+approve\s+1\s+or\s+reject\s+\d/i.test(String(latest.content || ''))) return false
  const at = validTime(latest.created_at)
  if (at == null || nowMs - at > APPROVAL_ASK_MAX_AGE_MS || at - nowMs > 60_000) return false
  const current = normalizeTurnText(currentText)
  return !turns.some((t) => t?.role === 'user' && (validTime(t.created_at) ?? 0) > at && normalizeTurnText(t.content) !== current)
}
